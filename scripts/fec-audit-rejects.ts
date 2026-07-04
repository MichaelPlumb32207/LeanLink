/**
 * Audit non-confirmed FEC hits — find near-misses and why they scored low.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { scoreFecContributionsAgainstVoter } from '../lib/fec/identity-match';
import type { ParsedFlVoterRecord } from '../lib/fl-voter-registration';
import type { FecContributionHit } from '../lib/fec/contributor-lookup';

function loadEnvLocal() {
  const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  loadEnvLocal();
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  const rows = await pool.query<{
    row_index: number;
    contributor_name: string;
    match_level: string;
    raw_data: ParsedFlVoterRecord;
    contributions: FecContributionHit[];
    identity_band: string;
    identity_best_score: number;
  }>(
    `SELECT flr.row_index, flr.contributor_name, flr.match_level, vr.raw_data,
            flr.contributions, flr.identity_band, flr.identity_best_score
     FROM fec_lookup_results flr
     JOIN voter_records vr ON vr.id = flr.voter_record_id
     JOIN fec_sweep_jobs j ON j.id = flr.sweep_job_id
     WHERE flr.has_hits = TRUE AND flr.probable_same_person = FALSE
     ORDER BY flr.identity_best_score DESC, flr.row_index`,
  );

  console.log(`Rejected hit rows: ${rows.rows.length}\n`);

  for (const row of rows.rows.slice(0, 12)) {
    const voter = row.raw_data;
    const scored = scoreFecContributionsAgainstVoter({
      voter,
      contributions: row.contributions,
      matchLevel: row.match_level as 'strict' | 'state_only' | 'none',
    });
    const top3 = scored.contributions.slice(0, 3);

    console.log(`--- Row ${row.row_index}: ${row.contributor_name} (${row.match_level}) band=${row.identity_band} best=${row.identity_best_score}`);
    console.log(`  Voter: ${voter.residence.city} ${voter.residence.zip?.slice(0, 5)}`);
    for (const s of top3) {
      const c = s.contribution;
      console.log(
        `  score=${s.identity_score} | ${c.contributor_name} | ${c.contributor_city ?? '?'} ${c.contributor_zip ?? '?'} | ${c.committee_name ?? c.candidate_name ?? '?'}`,
      );
      console.log(`    reasons: ${s.match_reasons.join(', ')}`);
    }
    const withZip = scored.contributions.filter((s) => s.match_reasons.includes('zip5_match'));
    const withCity = scored.contributions.filter((s) =>
      s.match_reasons.some((r) => r.includes('city')),
    );
    if (withZip.length) console.log(`  Contributions with zip match: ${withZip.length}`);
    if (withCity.length) console.log(`  Contributions with city match: ${withCity.length}`);
    console.log('');
  }

  // Strict query hits that still failed confirmation
  const strictFails = rows.rows.filter((r) => r.match_level === 'strict');
  console.log(`Strict-query rows not confirmed: ${strictFails.length}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});