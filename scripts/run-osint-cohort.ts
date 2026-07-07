/**
 * Tier-3 (OSINT) measured cohort — a HARD-dollar-capped Grok run over a small,
 * curated set of eligible voters, to measure Tier-3 yield before it earns a
 * place in the default waterfall. This is the only arm that spends real money
 * per voter (paid Grok/Apify), so the cap is enforced belt-and-suspenders:
 *
 *   - `--limit N`     absolute voter ceiling (default 100)
 *   - `--max-usd D`   hard spend cap (default 5.00) — the run STOPS before
 *                     starting any voter that could breach it
 *   - `--est-usd E`   conservative per-voter estimate (default 0.05) used both
 *                     for the pre-flight projection and as the cap's guard when
 *                     the API under-reports cost (guard = max(reported, N×est))
 *
 * The cap binds on `max(reported spend, processed × est)`, so even an API that
 * returns $0 cost can never run past `max-usd / est` voters. Runs SEQUENTIALLY
 * (concurrency 1) on purpose — parallel calls would make the cap fuzzy by up to
 * N voters. A 100-voter grok-full pass is ~30–50 min; that's fine for a one-off.
 *
 * Usage:
 *   # Preview the cohort + projected max cost, ZERO Grok calls, no spend:
 *   npx tsx scripts/run-osint-cohort.ts --county DUV --limit 100 --dry-run
 *
 *   # Live measured run (real spend — needs XAI_API_KEY):
 *   npx tsx scripts/run-osint-cohort.ts --county DUV --limit 100 --max-usd 5 --mode grok-full
 *
 * Cohort selection (`--select`, default `rich`):
 *   rich   — eligible voters (unsettled by tiers 0–2, not accepted) that carry
 *            the most for OSINT to work with (email, then history), row_index
 *            tiebreak. Measures Tier-3's *upper-bound* yield on workable records.
 *   sample — deterministic spread across the eligible pool (md5(id) order).
 *            Representative of the whole remainder (includes thin records).
 *
 * Writes an OSINT evidence event + fuses each voter (settlement/tier-fee happen
 * inside fusion, and only bill if the upload has a billing account — FL-extract
 * research uploads never do). Records arm_runs lifecycle so the box score shows
 * it live. Ctrl-C marks the run cancelled. Bracket it with repass-diff.ts to
 * report the delta (ENH-010).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool, type PoolClient } from 'pg';
import { keepAwakeWhileRunning } from '@/lib/cli/keep-awake';
import { ensureUploadHouseholdIndex, buildBundleWithAnchorProfile } from '@/lib/anchor/enrichment-context';
import { runEnrichmentPipeline } from '@/lib/enrichment/grok-pipeline';
import { parseEnrichmentMode } from '@/lib/enrichment/modes';
import { getXaiApiKey } from '@/lib/xai/client';
import { appendEvidenceEvent, fuseAndPersistVoter } from '@/lib/evidence/ledger';
import { buildOsintEvidenceEvent } from '@/lib/evidence/osint-events';
import { getUploadAccountId, chargeOsintAttempt } from '@/lib/billing/ledger';
import { resolveRates } from '@/lib/billing/rates';
import { CLAIM_ELIGIBLE_PREDICATE, startArmRun, heartbeatArmRun, finishArmRun } from '@/lib/evidence/arm-runs';
import type { UploadHouseholdIndex } from '@/lib/anchor/upload-index';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface CohortRow {
  id: string;
  row_index: number;
  raw_data: ParsedFlVoterRecord;
  history_summary: VoterHistorySummary | null;
  ballot_favors: BallotFavors;
  has_email: boolean;
  has_history: boolean;
}

async function selectCohort(
  client: PoolClient,
  uploadId: string,
  userId: string,
  select: 'rich' | 'sample',
  limit: number,
): Promise<CohortRow[]> {
  // `rich`: email first (the biggest OSINT lever), then history, then row order.
  // `sample`: deterministic spread via md5 of the id (stable, PII-free ordering).
  const order =
    select === 'rich'
      ? `(vr.raw_data->>'email' IS NOT NULL AND vr.raw_data->>'email' <> '') DESC,
         (vr.history_summary IS NOT NULL) DESC,
         vr.row_index ASC`
      : `md5(vr.id::text) ASC`;
  const { rows } = await client.query<CohortRow>(
    `SELECT vr.id, vr.row_index, vr.raw_data, vr.history_summary, u.ballot_favors,
            (vr.raw_data->>'email' IS NOT NULL AND vr.raw_data->>'email' <> '') AS has_email,
            (vr.history_summary IS NOT NULL) AS has_history
     FROM voter_records vr
     JOIN voter_uploads u ON u.id = vr.upload_id
     WHERE vr.upload_id = $1 AND vr.user_id = $2
       AND ${CLAIM_ELIGIBLE_PREDICATE}
     ORDER BY ${order}
     LIMIT $3`,
    [uploadId, userId, limit],
  );
  return rows;
}

async function main() {
  loadEnvLocal();
  const email = process.env.ALLOWED_USER_EMAIL;
  const url = process.env.DATABASE_URL;
  if (!email || !url) throw new Error('ALLOWED_USER_EMAIL and DATABASE_URL required (load .env.local)');

  const dryRun = process.argv.includes('--dry-run');
  const mode = parseEnrichmentMode(arg('--mode') ?? 'grok-full');
  const limit = Math.max(1, Number(arg('--limit') ?? 100));
  const maxUsd = Number(arg('--max-usd') ?? 5);
  const estUsd = Number(arg('--est-usd') ?? 0.05);
  const select = (arg('--select') ?? 'rich') === 'sample' ? 'sample' : 'rich';
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('--max-usd must be a positive number');

  if (!dryRun && !getXaiApiKey()) {
    throw new Error('XAI_API_KEY not set — a measured Tier-3 run needs live Grok. Use --dry-run to preview the cohort.');
  }

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 3 });
  const client = await pool.connect();
  try {
    // Resolve upload.
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [email]);
    const uploadId = arg('--upload-id');
    const county = arg('--county');
    let resolved = uploadId ?? '';
    let label = uploadId ?? '';
    if (!resolved) {
      if (!county) throw new Error('Provide --upload-id UUID or --county XXX');
      const r = await client.query<{ id: string; filename: string }>(
        `SELECT id, filename FROM voter_uploads WHERE user_id = $1 AND filename ILIKE $2 ORDER BY created_at DESC LIMIT 1`,
        [email, `${county}_%`],
      );
      if (!r.rows[0]) throw new Error(`No upload found for county ${county}`);
      resolved = r.rows[0].id;
      label = r.rows[0].filename;
    }
    console.log(`Upload: ${label} (${resolved})`);

    const cohort = await selectCohort(client, resolved, email, select, limit);
    const withEmail = cohort.filter((c) => c.has_email).length;
    const withHistory = cohort.filter((c) => c.has_history).length;
    const projectedMax = Math.min(maxUsd, cohort.length * estUsd);
    console.log(
      `Cohort: ${cohort.length} eligible voters (select=${select}) · ${withEmail} with email · ${withHistory} with history`,
    );
    console.log(`Mode: ${mode} · limit ${limit} · est $${estUsd.toFixed(3)}/voter · HARD cap $${maxUsd.toFixed(2)}`);
    console.log(`Projected max spend: ~$${projectedMax.toFixed(2)} (${cohort.length} × $${estUsd.toFixed(3)}, capped)`);

    if (dryRun) {
      console.log('\nDRY RUN — no Grok calls, no spend. Re-run without --dry-run to execute.');
      return;
    }
    if (cohort.length === 0) {
      console.log('No eligible voters — nothing to do.');
      return;
    }

    keepAwakeWhileRunning('the Tier-3 OSINT cohort run');

    const householdIndex: UploadHouseholdIndex = await ensureUploadHouseholdIndex(client, resolved, email);
    const accountId = await getUploadAccountId(client, resolved);
    const rates = accountId ? await resolveRates(client, accountId) : null;
    if (accountId) console.log(`Billing account ${accountId} — OSINT attempt $${rates!.osintAttempt} each (hit → tier-3 fee on settle).`);
    else console.log('No billing account on this upload (research-track) — measured spend recorded on events, not billed.');

    const runId = await startArmRun(client, {
      uploadId: resolved,
      userId: email,
      arm: 'osint',
      runner: 'osint_cohort_cli',
      totalCount: cohort.length,
      meta: { mode, limit, max_usd: maxUsd, select },
    });
    if (!runId) {
      throw new Error('An active osint run already holds the slot for this upload (arm_runs). Retry after the 10-min reaper if it is dead.');
    }

    let cancelling = false;
    const finish = async (status: 'completed' | 'cancelled' | 'failed', err?: string) => {
      const c = await pool.connect();
      try {
        await c.query(`SELECT set_config('app.current_user', $1, true)`, [email]);
        await finishArmRun(c, runId, status, err);
      } catch {
        /* reaper covers us */
      } finally {
        c.release();
      }
    };
    process.on('SIGINT', () => {
      if (cancelling) return;
      cancelling = true;
      console.log('\nCancelling — marking arm_runs cancelled…');
      void finish('cancelled').then(() => process.exit(130));
    });

    const funnel = {
      processed: 0,
      identity_none: 0,
      identity_ambiguous: 0,
      identity_probable: 0,
      leans: 0,
      settled_here: 0,
      lean_left: 0,
      lean_right: 0,
      lean_ind: 0,
    };
    let spentReported = 0;

    try {
      for (const voter of cohort) {
        if (cancelling) break;
        // Cap guard: stop before a voter that could breach max-usd. Guard on the
        // higher of reported spend and processed×est so a $0-reporting API still bites.
        const guardSoFar = Math.max(spentReported, funnel.processed * estUsd);
        if (guardSoFar + estUsd > maxUsd) {
          console.log(`\nSpend cap reached (guard $${guardSoFar.toFixed(2)} + est $${estUsd.toFixed(3)} > cap $${maxUsd.toFixed(2)}) — stopping at ${funnel.processed} voters.`);
          break;
        }

        const bundle = buildBundleWithAnchorProfile(voter.raw_data, voter.history_summary, voter.ballot_favors, {
          voterRecordId: voter.id,
          householdIndex,
        });

        let costThis = 0;
        try {
          const result = await runEnrichmentPipeline(bundle, mode, { includeDebug: true });
          costThis = result.debug?.usage?.cost_usd ?? 0;
          spentReported += costThis;

          const status = result.enrichment.identity_resolution_status;
          if (status === 'probable') funnel.identity_probable += 1;
          else if (status === 'ambiguous') funnel.identity_ambiguous += 1;
          else funnel.identity_none += 1;

          const hasLean = result.enrichment.lean_signals_found && result.lean !== 'Undetermined' && status === 'probable';
          if (hasLean) {
            funnel.leans += 1;
            if (result.lean === 'Left') funnel.lean_left += 1;
            else if (result.lean === 'Right') funnel.lean_right += 1;
            else if (result.lean === 'Independent') funnel.lean_ind += 1;
          }

          // Persist evidence + fuse (voter-scoped, its own transaction).
          await client.query('BEGIN');
          await client.query(`SELECT set_config('app.current_user', $1, true)`, [email]);
          await appendEvidenceEvent(
            client,
            buildOsintEvidenceEvent({
              upload_id: resolved,
              voter_record_id: voter.id,
              user_id: email,
              mode,
              result,
              cost_usd: costThis || null,
            }),
          );
          if (accountId && rates) {
            await chargeOsintAttempt(client, {
              userId: email,
              accountId,
              uploadId: resolved,
              voterRecordId: voter.id,
              amount: rates.osintAttempt,
              arm: 'osint',
              note: `osint attempt (${mode})`,
            });
          }
          await fuseAndPersistVoter(client, voter.id, resolved, email);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          console.error(`  row ${voter.row_index}: ${e instanceof Error ? e.message : e}`);
        }

        funnel.processed += 1;
        if (funnel.processed % 10 === 0 || funnel.processed === cohort.length) {
          await client.query('BEGIN');
          await client.query(`SELECT set_config('app.current_user', $1, true)`, [email]);
          await heartbeatArmRun(client, runId, {
            processed: funnel.processed,
            hits: funnel.identity_probable + funnel.identity_ambiguous,
            confirmed: funnel.identity_probable,
            leanSignals: funnel.leans,
          });
          await client.query('COMMIT');
          console.log(
            `  ${funnel.processed}/${cohort.length} · probable ${funnel.identity_probable} · leans ${funnel.leans} · $${spentReported.toFixed(3)}`,
          );
        }
      }
      if (!cancelling) await finish('completed');
    } catch (e) {
      await finish('failed', e instanceof Error ? e.message : String(e));
      throw e;
    }

    // Settled-at-tier-3-by-osint is a fusion side effect — count it from the DB.
    const settledRes = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM voter_lean_fusion
       WHERE upload_id = $1 AND settled_tier = 3 AND settled_arm = 'osint'`,
      [resolved],
    );
    funnel.settled_here = Number(settledRes.rows[0]?.n ?? 0);

    const avg = funnel.processed ? spentReported / funnel.processed : 0;
    console.log('\n--- Tier-3 OSINT cohort result ---');
    console.log(JSON.stringify({ upload: label, mode, select, ...funnel, spent_usd: Number(spentReported.toFixed(4)), avg_usd_per_voter: Number(avg.toFixed(4)), cap_usd: maxUsd }, null, 2));
    const rate = funnel.processed ? (funnel.leans / funnel.processed) * 100 : 0;
    console.log(`Tier-3 lean yield: ${funnel.leans}/${funnel.processed} = ${rate.toFixed(2)}% (select=${select}${select === 'rich' ? ', upper-bound' : ''}).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
