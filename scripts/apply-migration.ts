/**
 * Apply a SQL migration file to Neon (idempotent migrations only).
 * Usage: npx tsx scripts/apply-migration.ts migrations/006_reference_data.sql
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

async function main() {
  loadEnvLocal();
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npx tsx scripts/apply-migration.ts migrations/NNN_name.sql');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing — set in .env.local');
    process.exit(1);
  }

  const sql = readFileSync(join(process.cwd(), file), 'utf8');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });

  try {
    console.log(`Applying ${file}…`);
    await pool.query(sql);
    console.log(`OK: ${file}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});