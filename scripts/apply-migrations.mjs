/**
 * Apply LeanLink migrations without psql, using the project's `pg` driver.
 * Reads DATABASE_URL from the environment or from ./.env.local.
 * Idempotent migrations — safe to re-run.
 *
 * Run from the repo root:
 *   node scripts/apply-migrations.mjs
 *
 * Optionally pass specific files:
 *   node scripts/apply-migrations.mjs migrations/009_billing.sql
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

// Default set (in order) if no files passed on the command line.
const DEFAULT_FILES = [
  'migrations/007_committee_lean.sql',
  'migrations/008_generic_intake_and_settlement.sql',
  'migrations/009_billing.sql',
  'migrations/010_fec_retry.sql',
  'migrations/011_initiation_and_review.sql',
  'migrations/012_fl_extract_unbilled.sql',
];

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  } catch {
    /* no .env.local */
  }
  return null;
}

async function main() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;
  const connectionString = loadDatabaseUrl();
  if (!connectionString) throw new Error('DATABASE_URL not found in env or .env.local');

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true } });
  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = readFileSync(resolve(process.cwd(), file), 'utf8');
      process.stdout.write(`Applying ${file} ... `);
      await client.query(sql);
      console.log('done');
    }
    console.log('\nAll migrations applied.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('\nMIGRATION ERROR:', e.message);
  process.exit(1);
});
