/**
 * Check FEC bulk-load progress from any terminal, any time:
 *   node scripts/fec-indiv-status.mjs
 *
 * State lives in the reference_snapshots row the loader updates as it runs, so
 * this works even while (or long after) the import terminal is closed.
 * Reads DATABASE_URL from the environment or ./.env.local. Read-only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

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

function ago(iso) {
  if (!iso) return '—';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 6) / 10} h ago`;
}

const url = loadDatabaseUrl();
if (!url) {
  console.error('DATABASE_URL not found in env or .env.local');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
const { rows } = await pool.query(
  `SELECT id, label, row_count, notes, imported_at, completed_at
   FROM reference_snapshots
   WHERE source = 'fec_indiv'
   ORDER BY imported_at DESC`,
);

if (rows.length === 0) {
  console.log('No FEC bulk snapshots yet. Run scripts/import-fec-indiv.ts first.');
} else {
  for (const r of rows) {
    let notes = {};
    try {
      notes = JSON.parse(r.notes ?? '{}');
    } catch {
      /* legacy/plain notes */
    }
    const ready = r.completed_at != null;
    const state = ready ? 'READY' : 'LOADING';
    console.log(`\n[${state}] ${r.label}  (snapshot ${r.id.slice(0, 8)}…)`);
    console.log(`  rows loaded:   ${Number(r.row_count).toLocaleString()}`);
    if (!ready && notes.pct != null) {
      console.log(`  file progress: ${notes.pct}% · ${Number(notes.lines_read ?? 0).toLocaleString()} lines read · ${Number(notes.rate_lines_per_s ?? 0).toLocaleString()} lines/s`);
    }
    console.log(`  last update:   ${ago(notes.updated_at ?? (ready ? r.completed_at : null))}`);
    if (ready) console.log(`  completed:     ${new Date(r.completed_at).toLocaleString()}`);
    if (!ready && notes.updated_at && Date.now() - new Date(notes.updated_at).getTime() > 5 * 60_000) {
      console.log('  ⚠ no progress in >5 min — the import process may have stopped; re-run the same import command to resume.');
    }
  }
  const active = rows.find((r) => r.completed_at != null);
  console.log(
    active
      ? `\nActive snapshot for lookups: ${active.label}`
      : '\nNo READY snapshot yet — lookups will report the index as missing until a load completes.',
  );
}
await pool.end();
