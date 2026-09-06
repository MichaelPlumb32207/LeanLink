/**
 * One-off: apply 004 migration (idempotent) + rescore latest FEC sweep + print summary.
 * Usage: npx tsx scripts/fec-rescore-summary.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { rescoreFecSweepJob } from '../lib/fec/rescore-results';

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* no .env.local */
  }
}

async function main() {
  loadEnvLocal();
  const url = process.env.DATABASE_URL;
  const user = process.env.ALLOWED_USER_EMAIL;
  if (!user) throw new Error('ALLOWED_USER_EMAIL required');
  if (!url) throw new Error('DATABASE_URL missing');

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
  const client = await pool.connect();

  try {
    for (const file of ['004_fec_identity.sql', '005_evidence_ledger.sql']) {
      const migration = readFileSync(join(process.cwd(), 'migrations', file), 'utf8');
      await client.query(migration);
      console.log(`Migration ${file} applied (idempotent).`);
    }

    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [user]);

    const jobRes = await client.query<{
      id: string;
      upload_id: string;
      processed_count: number;
      hits_count: number;
      confirmed_hits_count: number;
      failed_count: number;
    }>(
      `SELECT id, upload_id, processed_count, hits_count,
              COALESCE(confirmed_hits_count, 0) AS confirmed_hits_count, failed_count
       FROM fec_sweep_jobs
       ORDER BY created_at DESC
       LIMIT 1`,
    );
    const job = jobRes.rows[0];
    if (!job) {
      console.log('No FEC sweep job found.');
      await client.query('COMMIT');
      return;
    }

    const { rescored } = await rescoreFecSweepJob(client, job.id);
    await client.query('COMMIT');

    const stats = await pool.connect();
    try {
      await stats.query(`SELECT set_config('app.current_user', $1, true)`, [user]);
      const bandRes = await stats.query<{ identity_band: string; count: string }>(
        `SELECT COALESCE(identity_band, 'unscored') AS identity_band, COUNT(*)::text AS count
         FROM fec_lookup_results
         WHERE sweep_job_id = $1 AND has_hits = TRUE
         GROUP BY identity_band
         ORDER BY count DESC`,
        [job.id],
      );

      const leanRes = await stats.query<{ fec_lean: string; count: string }>(
        `SELECT fec_lean, COUNT(*)::text AS count
         FROM fec_lookup_results
         WHERE sweep_job_id = $1 AND probable_same_person = TRUE AND fec_lean IS NOT NULL
         GROUP BY fec_lean`,
        [job.id],
      );

      const sampleRes = await stats.query(
        `SELECT row_index, contributor_name, match_level, result_count,
                identity_band, probable_same_person, identity_best_score, fec_lean, fec_lean_confidence
         FROM fec_lookup_results
         WHERE sweep_job_id = $1 AND has_hits = TRUE
         ORDER BY identity_best_score DESC NULLS LAST, row_index
         LIMIT 15`,
        [job.id],
      );

      const jobAfter = await stats.query<{ confirmed_hits_count: number }>(
        `SELECT COALESCE(confirmed_hits_count, 0) AS confirmed_hits_count FROM fec_sweep_jobs WHERE id = $1`,
        [job.id],
      );

      console.log('\n--- Calhoun FEC sweep summary ---');
      console.log(`Job: ${job.id}`);
      console.log(`Processed: ${job.processed_count} · raw hits: ${job.hits_count} · API errors: ${job.failed_count}`);
      console.log(`Rescored rows: ${rescored}`);
      console.log(`Confirmed matches (probable_same_person): ${jobAfter.rows[0]?.confirmed_hits_count ?? 0}`);
      console.log('\nIdentity bands (hit rows only):');
      for (const row of bandRes.rows) {
        console.log(`  ${row.identity_band}: ${row.count}`);
      }
      if (leanRes.rows.length) {
        console.log('\nFEC lean (confirmed rows):');
        for (const row of leanRes.rows) {
          console.log(`  ${row.fec_lean}: ${row.count}`);
        }
      }
      console.log('\nTop scored hits:');
      for (const row of sampleRes.rows) {
        const r = row as Record<string, unknown>;
        console.log(
          `  Row ${r.row_index}: ${r.contributor_name} · ${r.match_level} · band=${r.identity_band} · score=${r.identity_best_score} · confirmed=${r.probable_same_person} · lean=${r.fec_lean ?? '—'}`,
        );
      }

      const confirmedRes = await stats.query(
        `SELECT row_index, contributor_name, fec_lean, fec_lean_confidence, contributions
         FROM fec_lookup_results
         WHERE sweep_job_id = $1 AND probable_same_person = TRUE
         ORDER BY row_index`,
        [job.id],
      );
      if (confirmedRes.rows.length) {
        console.log('\nConfirmed donation detail:');
        for (const row of confirmedRes.rows) {
          const r = row as {
            row_index: number;
            contributor_name: string;
            fec_lean: string;
            fec_lean_confidence: number;
            contributions: { committee_name?: string; candidate_name?: string; contributor_city?: string; contributor_zip?: string; amount?: number }[];
          };
          const c = r.contributions?.[0];
          console.log(
            `  Row ${r.row_index} ${r.contributor_name}: ${r.fec_lean} (${r.fec_lean_confidence}%) → ${c?.committee_name ?? c?.candidate_name ?? '?'} · ${c?.contributor_city} ${c?.contributor_zip} · $${c?.amount ?? '?'}`,
          );
        }
      }
    } finally {
      stats.release();
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});