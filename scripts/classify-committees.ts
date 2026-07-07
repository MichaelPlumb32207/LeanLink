/**
 * Classify unresolved committees with Grok (ENH-018 Unit B) and (optionally)
 * write them as AGENT committee labels, so confirmed donors to committees with
 * no party code / no pattern (Harris Victory Fund, The Lincoln Project, union
 * PACs) can finally settle. One Grok call per committee (batched), not per
 * voter — cheap, accurate, and it dodges every identity/privacy wall.
 *
 * Precedence is enforced by the source-aware upsert: the agent NEVER overwrites
 * a human label; a human can override + lock any committee. Genuinely bipartisan
 * corporate PACs come back Undetermined and are NOT written (no manufactured
 * signal).
 *
 * Modes:
 *   --dry-run            census only — the unresolved work-list + voter counts,
 *                        NO Grok call, NO writes, NO spend.
 *   (default)            classify via Grok and print proposals — NO writes.
 *                        This IS the "agent proposes" step; review it.
 *   --apply              classify AND write agent labels (skips human-labeled).
 *                        On a BILLED account, review with the default mode first
 *                        (applying a lean settles + bills its donors).
 *
 * After --apply, re-score to settle the recovered donors, bracketed to measure:
 *   npx tsx scripts/repass-diff.ts snapshot --county DUV
 *   npx tsx scripts/run-fec-index.ts --county DUV --concurrency 8
 *   npx tsx scripts/repass-diff.ts report --county DUV --md duv-committees.md
 *
 * Usage:
 *   npx tsx scripts/classify-committees.ts --county DUV --dry-run
 *   npx tsx scripts/classify-committees.ts --county DUV --limit 150
 *   npx tsx scripts/classify-committees.ts --county DUV --apply
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool, type PoolClient } from 'pg';
import { loadLeanPatterns } from '@/lib/lean-patterns/registry';
import { scanLeanPatterns } from '@/lib/lean-patterns/patterns';
import { loadResearcherCommitteeLabels } from '@/lib/committee-lean/store';
import { inferLeanFromCommitteeName } from '@/lib/committee-lean/infer';
import { committeeNameNorm } from '@/lib/committee-lean/normalize';
import { classifyCommittees } from '@/lib/committee-lean/classify';
import { upsertAgentCommitteeLabel } from '@/lib/committee-lean/store';
import { getXaiApiKey } from '@/lib/xai/client';
import { getActiveFecIndivSnapshotSet, processFecIndexVoter } from '@/lib/fec/run-index-upload';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

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

interface CensusRow {
  committee: string;
  voters: number;
  source: string;
}

async function gatherUnresolvedCensus(client: PoolClient, uploadId: string): Promise<CensusRow[]> {
  // FEC: committees from confirmed-donor receipts on still-Undetermined voters.
  const fec = await client.query<CensusRow>(
    `SELECT r->>'committee' AS committee, count(DISTINCT ee.voter_record_id)::int AS voters, 'fec' AS source
     FROM evidence_events ee
     JOIN voter_lean_fusion f ON f.voter_record_id = ee.voter_record_id
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ee.payload->'receipts','[]'::jsonb)) r
     WHERE ee.upload_id = $1 AND ee.arm = 'fec' AND ee.probable_same_person = true
       AND (f.lean = 'Undetermined' OR f.lean IS NULL)
       AND r->>'committee' IS NOT NULL AND r->>'committee' <> ''
     GROUP BY 1`,
    [uploadId],
  );
  // FL contrib: committees the event-write step already flagged unresolved.
  const fl = await client.query<CensusRow>(
    `SELECT c AS committee, count(DISTINCT ee.voter_record_id)::int AS voters, 'fl' AS source
     FROM evidence_events ee
     CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(ee.payload->'unresolved_committees','[]'::jsonb)) c
     WHERE ee.upload_id = $1 AND ee.source = 'fl_contrib_index'
     GROUP BY 1`,
    [uploadId],
  );

  // Merge by normalized name, sum voters, keep a display name + source tag.
  const merged = new Map<string, CensusRow>();
  for (const r of [...fec.rows, ...fl.rows]) {
    const key = committeeNameNorm(r.committee);
    if (!key) continue;
    const prev = merged.get(key);
    if (prev) {
      prev.voters += r.voters;
      if (!prev.source.includes(r.source)) prev.source += `+${r.source}`;
    } else {
      merged.set(key, { committee: r.committee, voters: r.voters, source: r.source });
    }
  }
  return [...merged.values()].sort((a, b) => b.voters - a.voters);
}

async function main() {
  loadEnvLocal();
  const email = process.env.ALLOWED_USER_EMAIL;
  const url = process.env.DATABASE_URL;
  if (!email || !url) throw new Error('ALLOWED_USER_EMAIL and DATABASE_URL required');

  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  const limit = Math.max(1, Number(arg('--limit') ?? 150));
  if (!dryRun && !getXaiApiKey()) {
    throw new Error('XAI_API_KEY not set — classify needs Grok (use --dry-run to see the census for free).');
  }

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
  const client = await pool.connect();
  try {
    // Session-scoped (is_local=false) so app.current_user stays set across the
    // apply writes + per-batch re-score transactions on this dedicated connection.
    await client.query(`SELECT set_config('app.current_user', $1, false)`, [email]);
    const uploadId = arg('--upload-id');
    const county = arg('--county');
    let resolved = uploadId ?? '';
    let accountId: string | null = null;
    if (!resolved) {
      if (!county) throw new Error('Provide --upload-id UUID or --county XXX');
      const r = await client.query<{ id: string; account_id: string | null; filename: string }>(
        `SELECT id, account_id, filename FROM voter_uploads WHERE user_id = $1 AND filename ILIKE $2 ORDER BY created_at DESC LIMIT 1`,
        [email, `${county}_%`],
      );
      if (!r.rows[0]) throw new Error(`No upload found for county ${county}`);
      resolved = r.rows[0].id;
      accountId = r.rows[0].account_id;
      console.log(`Upload: ${r.rows[0].filename} (${resolved})${accountId ? ` · BILLED account ${accountId}` : ' · unbilled (research)'}`);
    } else {
      const r = await client.query<{ account_id: string | null }>(`SELECT account_id FROM voter_uploads WHERE id = $1`, [resolved]);
      accountId = r.rows[0]?.account_id ?? null;
    }

    const patterns = await loadLeanPatterns(client, email);
    const labels = await loadResearcherCommitteeLabels(client, email);

    // Gather the census, then keep only the TRULY unresolved (no existing label,
    // no fl-pattern, no fec-pattern match) — so we never re-classify a resolved one.
    const census = await gatherUnresolvedCensus(client, resolved);
    const unresolved = census.filter((c) => {
      const byLabelOrFl = inferLeanFromCommitteeName(c.committee, labels, patterns); // label + fl patterns
      if (byLabelOrFl) return false;
      const byFec = scanLeanPatterns(c.committee, patterns.fec);
      return !byFec;
    });
    const work = unresolved.slice(0, limit);

    console.log(`\nUnresolved committees: ${unresolved.length} (showing top ${work.length} by donor count)`);
    const totalVoters = work.reduce((s, c) => s + c.voters, 0);
    console.log(`Donors potentially recoverable across them: ${totalVoters.toLocaleString()}\n`);

    if (dryRun) {
      for (const c of work) console.log(`  ${String(c.voters).padStart(4)}  [${c.source}] ${c.committee}`);
      console.log('\nDRY RUN — census only. Drop --dry-run to classify with Grok (no writes without --apply).');
      return;
    }

    // Classify with Grok (no web search — its own knowledge).
    console.log(`Classifying ${work.length} committees with Grok…`);
    const { results, cost_usd, batches } = await classifyCommittees(work.map((c) => c.committee));
    const votersByName = new Map(work.map((c) => [c.committee.toLowerCase(), c.voters]));

    const partisan = results.filter((r) => r.lean !== 'Undetermined');
    const bipartisan = results.filter((r) => r.lean === 'Undetermined');
    partisan.sort((a, b) => (votersByName.get(b.committee_name.toLowerCase()) ?? 0) - (votersByName.get(a.committee_name.toLowerCase()) ?? 0));

    console.log(`\n=== Proposals (${batches} batch(es), $${cost_usd.toFixed(3)}) ===`);
    console.log(`Partisan (would apply): ${partisan.length} · Bipartisan/unknown (left blank): ${bipartisan.length}\n`);
    let recoverable = 0;
    for (const r of partisan) {
      const v = votersByName.get(r.committee_name.toLowerCase()) ?? 0;
      recoverable += v;
      console.log(`  ${String(v).padStart(4)}  ${r.lean.padEnd(11)} (${String(r.confidence).padStart(3)})  ${r.committee_name}  — ${r.reason}`);
    }
    console.log(`\n  → ${recoverable.toLocaleString()} donors sit behind these partisan committees.`);
    if (bipartisan.length) {
      console.log(`\nLeft Undetermined (bipartisan / unknown — correctly NOT labeled):`);
      for (const r of bipartisan.slice(0, 15)) console.log(`  · ${r.committee_name} — ${r.reason}`);
      if (bipartisan.length > 15) console.log(`  · (+${bipartisan.length - 15} more)`);
    }

    if (!apply) {
      console.log('\nPROPOSALS ONLY — nothing written. Re-run with --apply to write agent labels.');
      if (accountId) console.log('(This is a BILLED account — applying a lean will settle + bill its donors. Review above first.)');
      return;
    }

    // Apply: write agent labels for partisan proposals (never overwrites a human).
    let applied = 0;
    let skippedHuman = 0;
    for (const r of partisan) {
      const out = await upsertAgentCommitteeLabel(client, {
        user_id: email,
        committee_name: r.committee_name,
        lean: r.lean,
        confidence: r.confidence,
        notes: `Grok: ${r.reason}`.slice(0, 400),
      });
      if (out.applied) applied += 1;
      else if (out.skipped_human) skippedHuman += 1;
    }
    console.log(`\nApplied ${applied} agent labels${skippedHuman ? ` · skipped ${skippedHuman} already human-labeled` : ''}.`);

    // Targeted re-score: only CONFIRMED FEC donors can change from a committee
    // label (non-donors have no committee), so re-score just them — a few
    // hundred voters, not the whole 146k county. Reuses the exact index scoring
    // path (re-lookup + score with the fresh labels + re-fuse → settle).
    const snapshots = await getActiveFecIndivSnapshotSet(client);
    if (!snapshots) {
      console.log('No READY fec_indiv snapshot — cannot re-score. Load one, then re-run with --apply.');
      return;
    }
    const freshLabels = await loadResearcherCommitteeLabels(client, email);
    const donors = await client.query<{ id: string; row_index: number; raw_data: ParsedFlVoterRecord }>(
      `SELECT DISTINCT vr.id, vr.row_index, vr.raw_data
       FROM voter_records vr
       JOIN evidence_events ee ON ee.voter_record_id = vr.id
       WHERE vr.upload_id = $1 AND ee.arm = 'fec' AND ee.probable_same_person = true
       ORDER BY vr.row_index`,
      [resolved],
    );
    const settledT1 = async () =>
      Number(
        (
          await client.query<{ n: string }>(
            `SELECT count(*)::text n FROM voter_lean_fusion WHERE upload_id = $1 AND settled_tier = 1`,
            [resolved],
          )
        ).rows[0].n,
      );
    const before = await settledT1();
    console.log(`Re-scoring ${donors.rows.length} confirmed FEC donors with the new labels…`);
    let done = 0;
    for (let i = 0; i < donors.rows.length; i += 10) {
      const batch = donors.rows.slice(i, i + 10);
      await client.query('BEGIN');
      try {
        for (const v of batch) {
          await processFecIndexVoter(client, {
            uploadId: resolved,
            userId: email,
            snapshots,
            voter: v,
            patterns,
            researcherLabels: freshLabels,
          });
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      }
      done += batch.length;
      if (done % 100 === 0 || done === donors.rows.length) console.log(`  re-scored ${done}/${donors.rows.length}`);
    }
    const after = await settledT1();
    console.log(`\nTier-1 settled: ${before} → ${after} (+${after - before} recovered by committee labels).`);
    console.log(`Deliverable-changing on a research upload — bracket with repass-diff next time if you want the full lean/confidence delta.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
