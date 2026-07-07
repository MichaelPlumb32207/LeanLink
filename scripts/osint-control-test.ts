/**
 * OSINT positive-control test (diagnostic — NO DB writes).
 *
 * The question isn't "can OSINT find lean on NPAs" — it's "can OSINT find lean
 * AT ALL". So we run it on voters where we KNOW a lean exists and see whether
 * the pipeline reports one:
 *   Group 1 — 5 voters already SETTLED with a verified lean (public donors,
 *             found by the FEC / FL-contrib arms). If OSINT can't rediscover a
 *             documented political donation, its SOURCES don't reach the one
 *             public record that carries lean for ordinary people.
 *   Group 2 — 5 party-REGISTERED (DEM/REP) Active voters parsed from the raw
 *             Calhoun extract (the Duval upload is NPA-only, and party is a
 *             weaker/private signal, but these voters are more engaged on avg).
 *
 * Runs grok-full, sequential, hard cost cap. Reports a table + hit rates.
 * Writes nothing — it's a diagnostic, not a production pass.
 *
 * Usage:
 *   npx tsx scripts/osint-control-test.ts --county DUV --party-file CAL_20250812.txt --max-usd 1
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { keepAwakeWhileRunning } from '@/lib/cli/keep-awake';
import { parseFlVoterLine, type ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import { ensureUploadHouseholdIndex, buildBundleWithAnchorProfile } from '@/lib/anchor/enrichment-context';
import { buildEnrichmentBundle } from '@/lib/enrichment/build-bundle';
import { runEnrichmentPipeline } from '@/lib/enrichment/grok-pipeline';
import { getXaiApiKey } from '@/lib/xai/client';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import type { EnrichmentBundle } from '@/lib/enrichment/types';

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

interface TestVoter {
  group: 'settled-lean' | 'party-reg';
  known: string; // known lean or registered party
  detail: string; // how we know (settled arm / party code)
  bundle: EnrichmentBundle;
  name: string;
}

/** Scan evidence + citations for whether OSINT surfaced the political signal. */
function foundPoliticalTrail(evidence: unknown[], urls: string[]): boolean {
  const hay = [...evidence.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))), ...urls]
    .join(' ')
    .toLowerCase();
  // Positive mentions (not the "No X found" boilerplate).
  const negated = /no (fec|florida campaign|opensecrets|donation|letters|op-eds|civic|activism|political)/.test(hay);
  const positive = /(fec\.gov|opensecrets|actblue|winred|donated|contribution to|endorse|campaign for|letter to the editor|op-ed|activist)/.test(hay);
  return positive && !negated;
}

async function main() {
  loadEnvLocal();
  const email = process.env.ALLOWED_USER_EMAIL;
  const url = process.env.DATABASE_URL;
  if (!email || !url) throw new Error('ALLOWED_USER_EMAIL and DATABASE_URL required');
  if (!getXaiApiKey()) throw new Error('XAI_API_KEY not set — this diagnostic needs live Grok.');

  const county = arg('--county') ?? 'DUV';
  const partyFile = arg('--party-file') ?? 'CAL_20250812.txt';
  const maxUsd = Number(arg('--max-usd') ?? 1);
  const estUsd = Number(arg('--est-usd') ?? 0.08);
  const perGroup = Math.max(1, Number(arg('--per-group') ?? 5));

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 3 });
  const client = await pool.connect();
  const voters: TestVoter[] = [];
  try {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [email]);

    // ---- Group 1: settled voters with a verified lean (top confidence, balanced L/R) ----
    const up = await client.query<{ id: string }>(
      `SELECT id FROM voter_uploads WHERE user_id = $1 AND filename ILIKE $2 ORDER BY created_at DESC LIMIT 1`,
      [email, `${county}_%`],
    );
    const uploadId = up.rows[0]?.id;
    if (!uploadId) throw new Error(`No ${county} upload found`);
    const householdIndex = await ensureUploadHouseholdIndex(client, uploadId, email);

    const leanRows = await client.query<{
      id: string;
      raw_data: ParsedFlVoterRecord;
      history_summary: VoterHistorySummary | null;
      ballot_favors: BallotFavors;
      lean: string;
      confidence: number;
      settled_arm: string | null;
    }>(
      `(SELECT vr.id, vr.raw_data, vr.history_summary, u.ballot_favors, f.lean, f.confidence, f.settled_arm
        FROM voter_lean_fusion f JOIN voter_records vr ON vr.id = f.voter_record_id
        JOIN voter_uploads u ON u.id = vr.upload_id
        WHERE f.upload_id = $1 AND f.settled_tier IS NOT NULL AND f.lean = 'Left'
        ORDER BY f.confidence DESC LIMIT $2)
       UNION ALL
       (SELECT vr.id, vr.raw_data, vr.history_summary, u.ballot_favors, f.lean, f.confidence, f.settled_arm
        FROM voter_lean_fusion f JOIN voter_records vr ON vr.id = f.voter_record_id
        JOIN voter_uploads u ON u.id = vr.upload_id
        WHERE f.upload_id = $1 AND f.settled_tier IS NOT NULL AND f.lean = 'Right'
        ORDER BY f.confidence DESC LIMIT $3)`,
      [uploadId, Math.ceil(perGroup / 2), Math.floor(perGroup / 2)],
    );
    for (const r of leanRows.rows) {
      voters.push({
        group: 'settled-lean',
        known: r.lean,
        detail: `settled via ${r.settled_arm ?? '?'} @ conf ${r.confidence}`,
        name: r.raw_data.name.full,
        bundle: buildBundleWithAnchorProfile(r.raw_data, r.history_summary, r.ballot_favors, {
          voterRecordId: r.id,
          householdIndex,
        }),
      });
    }

    // ---- Group 2: party-registered Active voters from the raw extract ----
    const raw = readFileSync(join(process.cwd(), partyFile), 'utf8');
    const partyVoters: ParsedFlVoterRecord[] = [];
    const seenParty = { DEM: 0, REP: 0 };
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let rec: ParsedFlVoterRecord | null = null;
      try {
        rec = parseFlVoterLine(line);
      } catch {
        continue;
      }
      if (!rec || rec.status !== 'ACT') continue;
      const p = rec.party;
      if ((p === 'DEM' || p === 'REP') && seenParty[p] < Math.ceil(perGroup / 2)) {
        seenParty[p] += 1;
        partyVoters.push(rec);
      }
      if (seenParty.DEM + seenParty.REP >= perGroup) break;
    }
    for (const rec of partyVoters) {
      voters.push({
        group: 'party-reg',
        known: rec.party,
        detail: `registered ${rec.party}`,
        name: rec.name.full,
        bundle: buildEnrichmentBundle(rec, null, 'north'),
      });
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`Test set: ${voters.length} voters (${voters.filter((v) => v.group === 'settled-lean').length} settled-lean + ${voters.filter((v) => v.group === 'party-reg').length} party-reg)`);
  console.log(`Mode grok-full · HARD cap $${maxUsd.toFixed(2)} · est $${estUsd}/voter\n`);
  keepAwakeWhileRunning('the OSINT control test');

  let spent = 0;
  let processed = 0;
  const results: { v: TestVoter; band: string; score: number | null; lean: string; conf: number | null; trail: boolean; cost: number }[] = [];

  for (const v of voters) {
    const guard = Math.max(spent, processed * estUsd);
    if (guard + estUsd > maxUsd) {
      console.log(`\nCap reached (guard $${guard.toFixed(2)}) — stopping at ${processed}.`);
      break;
    }
    try {
      const res = await runEnrichmentPipeline(v.bundle, 'grok-full', { includeDebug: true });
      const cost = res.debug?.usage?.cost_usd ?? 0;
      spent += cost;
      const trail = foundPoliticalTrail(res.evidence ?? [], res.enrichment.citations ?? []);
      results.push({
        v,
        band: res.enrichment.identity_resolution_status,
        score: res.enrichment.identity_best_match_score,
        lean: res.lean,
        conf: res.enrichment.lean_signals_found ? res.confidence : null,
        trail,
        cost,
      });
      console.log(
        `  [${v.group}] ${v.name} · known ${v.known} → OSINT identity ${res.enrichment.identity_resolution_status} · lean ${res.lean}${res.lean !== 'Undetermined' ? ` (${res.confidence})` : ''} · trail ${trail ? 'YES' : 'no'} · $${cost.toFixed(3)}`,
      );
    } catch (e) {
      console.error(`  [${v.group}] ${v.name}: ${e instanceof Error ? e.message : e}`);
    }
    processed += 1;
  }

  // ---- Verdict ----
  const g1 = results.filter((r) => r.v.group === 'settled-lean');
  const g2 = results.filter((r) => r.v.group === 'party-reg');
  const leaned = (rs: typeof results) => rs.filter((r) => r.lean !== 'Undetermined').length;
  const trailed = (rs: typeof results) => rs.filter((r) => r.trail).length;
  const matchedKnown = g1.filter((r) => r.lean === r.v.known).length;

  console.log('\n=========== VERDICT ===========');
  console.log(`Group 1 (settled-lean, n=${g1.length}): OSINT reported a lean on ${leaned(g1)}/${g1.length}` +
    ` (matched the known lean on ${matchedKnown}); found a public political trail on ${trailed(g1)}/${g1.length}.`);
  console.log(`Group 2 (party-reg,  n=${g2.length}): OSINT reported a lean on ${leaned(g2)}/${g2.length}; trail on ${trailed(g2)}/${g2.length}.`);
  console.log(`Total spend: $${spent.toFixed(3)} (${processed} voters, avg $${(processed ? spent / processed : 0).toFixed(3)}).`);
  console.log('\nRead: if Group 1 leaned ≈ 0, OSINT cannot rediscover documented donations —');
  console.log('the sources/approach need rethinking, not the cohort.');
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
