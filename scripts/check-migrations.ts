/**
 * List LeanLink tables / snapshot state on Neon.
 * Usage: npx tsx scripts/check-migrations.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

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

const EXPECTED = [
  'evidence_events',
  'voter_lean_fusion',
  'fec_lookup_results',
  'reference_snapshots',
  'fl_contributions',
  'sunbiz_officers',
];

async function main() {
  loadEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
  try {
    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])
       ORDER BY tablename`,
      [EXPECTED],
    );
    console.log('Tables present:');
    for (const name of EXPECTED) {
      const ok = tables.rows.some((r) => r.tablename === name);
      console.log(`  ${ok ? '✓' : '○'} ${name}`);
    }

    if (tables.rows.some((r) => r.tablename === 'reference_snapshots')) {
      const snaps = await pool.query(
        `SELECT source, label, row_count, imported_at FROM reference_snapshots ORDER BY imported_at DESC LIMIT 5`,
      );
      console.log('\nRecent reference_snapshots:');
      if (snaps.rows.length === 0) console.log('  (none — run import scripts next)');
      else console.table(snaps.rows);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});