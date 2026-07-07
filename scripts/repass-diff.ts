/**
 * Re-pass diff (ENH-010) — bracket a re-pass with a before/after delta.
 *
 * A re-pass (run-fec-index / run-free-pass on current logic) supersedes stale
 * events and re-fuses (DEF-009), but doesn't report what changed. This does.
 *
 * Workflow:
 *   1. Snapshot the baseline BEFORE re-scoring:
 *        npx tsx scripts/repass-diff.ts snapshot --county DUV
 *        npx tsx scripts/repass-diff.ts snapshot --upload-id UUID --out base.json
 *      (default --out is repass-baseline-<upload>.json in the CWD)
 *
 *   2. Run the re-pass (any arm), e.g.:
 *        npx tsx scripts/run-free-pass.ts --county DUV --steps sunbiz --concurrency 8
 *
 *   3. Report the delta AFTER it completes:
 *        npx tsx scripts/repass-diff.ts report --county DUV
 *        npx tsx scripts/repass-diff.ts report --upload-id UUID --baseline base.json --md diff.md
 *
 * Read-only: never writes to the DB. The baseline is a JSON file (single
 * operator; a few MB at county scale). No migration.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import {
  captureRepassSnapshot,
  diffRepassSnapshots,
  formatRepassDiffMarkdown,
  type RepassSnapshot,
} from '@/lib/evidence/repass-diff';
import { SCORER_VERSION } from '@/lib/evidence/scorer-version';

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

/** ISO timestamp without pulling in Date.now-forbidden helpers — plain new Date() is fine in a CLI. */
function nowIso(): string {
  return new Date().toISOString();
}

async function resolveUpload(
  pool: Pool,
  email: string,
): Promise<{ id: string; label: string }> {
  const uploadId = arg('--upload-id');
  const county = arg('--county');
  const c = await pool.connect();
  try {
    await c.query(`SELECT set_config('app.current_user', $1, true)`, [email]);
    if (uploadId) {
      const r = await c.query<{ filename: string }>(
        `SELECT filename FROM voter_uploads WHERE id = $1 AND user_id = $2`,
        [uploadId, email],
      );
      if (!r.rows[0]) throw new Error(`No upload ${uploadId} for ${email}`);
      return { id: uploadId, label: r.rows[0].filename };
    }
    if (!county) throw new Error('Provide --upload-id UUID or --county XXX');
    const r = await c.query<{ id: string; filename: string }>(
      `SELECT id, filename FROM voter_uploads
       WHERE user_id = $1 AND filename ILIKE $2
       ORDER BY created_at DESC LIMIT 1`,
      [email, `${county}_%`],
    );
    if (!r.rows[0]) throw new Error(`No upload found for county ${county}`);
    return { id: r.rows[0].id, label: r.rows[0].filename };
  } finally {
    c.release();
  }
}

async function main() {
  loadEnvLocal();
  const mode = process.argv[2];
  const email = process.env.ALLOWED_USER_EMAIL;
  const url = process.env.DATABASE_URL;
  if (!email || !url) throw new Error('ALLOWED_USER_EMAIL and DATABASE_URL required (load .env.local)');
  if (mode !== 'snapshot' && mode !== 'report') {
    console.error('Usage: repass-diff.ts <snapshot|report> --county XXX | --upload-id UUID [--baseline f.json] [--out f.json] [--md f.md]');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
  try {
    const upload = await resolveUpload(pool, email);
    console.error(`Upload: ${upload.label} (${upload.id})`);

    const c = await pool.connect();
    let current: RepassSnapshot;
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.current_user', $1, true)`, [email]);
      current = await captureRepassSnapshot(c, upload.id, SCORER_VERSION, nowIso());
      await c.query('COMMIT');
    } finally {
      c.release();
    }

    if (mode === 'snapshot') {
      const out = arg('--out') ?? join(process.cwd(), `repass-baseline-${upload.id}.json`);
      writeFileSync(out, JSON.stringify(current));
      console.error(`Baseline captured: ${current.voter_count.toLocaleString()} voters (scorer_v ${current.scorer_v}) → ${out}`);
      return;
    }

    // report
    const baselinePath = arg('--baseline') ?? join(process.cwd(), `repass-baseline-${upload.id}.json`);
    let before: RepassSnapshot;
    try {
      before = JSON.parse(readFileSync(baselinePath, 'utf8')) as RepassSnapshot;
    } catch {
      throw new Error(`Baseline not found: ${baselinePath} — run "snapshot" before the re-pass first.`);
    }
    if (before.upload_id !== upload.id) {
      throw new Error(`Baseline is for upload ${before.upload_id}, not ${upload.id}.`);
    }

    const diff = diffRepassSnapshots(before, current);
    const md = formatRepassDiffMarkdown(diff);
    const mdOut = arg('--md');
    if (mdOut) {
      writeFileSync(mdOut, md);
      console.error(`Markdown report → ${mdOut}`);
    }
    console.log(md);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
