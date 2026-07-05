/**
 * County-scale FL voter-extract ingest — the CLI path for files too big for the
 * dashboard upload (Vercel caps request bodies at ~4.5 MB; the browser path also
 * runs one long all-or-nothing transaction). Mirrors the upload route exactly:
 * same parser, same NPA+Active filter, same hash + insert (shared helper in
 * lib/ingest/insert-voter-records.ts), same research-track posture — FL DOS
 * extracts never get an account_id (D-027; migration-012 CHECK).
 *
 * Usage:
 *   npx tsx scripts/ingest-extract.ts --file "/path/to/DUV_20250812.txt" \
 *     [--history "/path/to/DUV_H_20250812.txt"] [--ballot-favors south|north] \
 *     [--chunk 2000]
 *   npx tsx scripts/ingest-extract.ts --file "/path/…" --resume <upload-id>
 *
 * Commits every chunk (default 2,000 rows) and prints progress; a killed run
 * leaves the upload in status 'pending' — re-run with --resume to continue from
 * the last committed row (parse order is deterministic, so row_index is stable).
 * The upload flips to 'ready' only when every row is in.
 */
import { readFileSync } from 'fs';
import { basename, join } from 'path';
import { Pool, type PoolClient } from 'pg';
import {
  DEFAULT_LEANLINK_FILTER,
  parseFlVoterFile,
} from '@/lib/fl-voter-registration';
import {
  buildHistorySummaryMap,
  type BallotFavors,
  type VoterHistorySummary,
} from '@/lib/fl-voter-history';
import { insertVoterRecords } from '@/lib/ingest/insert-voter-records';

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
    /* optional */
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function inUserTxn<T>(
  pool: Pool,
  userEmail: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Transaction-local (third arg true): every txn must re-set it or RLS
    // returns nothing / rejects writes.
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  loadEnvLocal();
  const filePath = arg('file');
  const historyPath = arg('history');
  const resumeId = arg('resume');
  const chunkSize = Math.max(100, Number(arg('chunk') ?? 2000));
  const ballotFavors: BallotFavors = arg('ballot-favors') === 'north' ? 'north' : 'south';
  const userEmail = process.env.ALLOWED_USER_EMAIL;

  if (!filePath) {
    console.error('Required: --file <path to FL registration extract>');
    process.exit(1);
  }
  if (!userEmail || !process.env.DATABASE_URL) {
    console.error('ALLOWED_USER_EMAIL / DATABASE_URL missing (.env.local)');
    process.exit(1);
  }

  const filename = basename(filePath);
  console.log(`Reading ${filename} …`);
  const records = parseFlVoterFile(readFileSync(filePath, 'utf8'), DEFAULT_LEANLINK_FILTER);
  console.log(`Parsed: ${records.length.toLocaleString()} NPA + Active voters`);
  if (records.length === 0) {
    console.error('No eligible NPA active voters found — is this a registration extract?');
    process.exit(1);
  }

  let historyMap = new Map<string, VoterHistorySummary>();
  let historyFilename: string | null = null;
  if (historyPath) {
    historyFilename = basename(historyPath);
    console.log(`Reading history ${historyFilename} …`);
    historyMap = buildHistorySummaryMap(readFileSync(historyPath, 'utf8'));
    console.log(`History summaries: ${historyMap.size.toLocaleString()} voters`);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    let uploadId: string;
    let startIndex = 0;

    if (resumeId) {
      const resume = await inUserTxn(pool, userEmail, async (client) => {
        const up = await client.query<{ filename: string; status: string }>(
          `SELECT filename, status FROM voter_uploads WHERE id = $1`,
          [resumeId],
        );
        if (!up.rows[0]) throw new Error(`Upload ${resumeId} not found`);
        if (up.rows[0].status !== 'pending') {
          throw new Error(
            `Upload ${resumeId} is '${up.rows[0].status}', not 'pending' — nothing to resume`,
          );
        }
        if (up.rows[0].filename !== filename) {
          throw new Error(
            `Upload ${resumeId} was created from ${up.rows[0].filename}, not ${filename}`,
          );
        }
        const max = await client.query<{ max: number | null }>(
          `SELECT MAX(row_index)::int AS max FROM voter_records WHERE upload_id = $1`,
          [resumeId],
        );
        return max.rows[0]?.max;
      });
      uploadId = resumeId;
      startIndex = (resume ?? -1) + 1;
      console.log(`Resuming upload ${uploadId} from row ${startIndex.toLocaleString()}`);
    } else {
      const existing = await inUserTxn(pool, userEmail, (client) =>
        client.query<{ id: string; status: string }>(
          `SELECT id, status FROM voter_uploads WHERE filename = $1 ORDER BY created_at DESC LIMIT 1`,
          [filename],
        ),
      );
      const prior = existing.rows[0];
      if (prior?.status === 'pending') {
        console.error(
          `An unfinished ingest of ${filename} exists (${prior.id}).\n` +
            `Continue it with: --resume ${prior.id}`,
        );
        process.exit(1);
      }
      if (prior) {
        console.log(
          `Note: ${filename} was already ingested as upload ${prior.id} (${prior.status}); creating a new upload.`,
        );
      }
      uploadId = await inUserTxn(pool, userEmail, async (client) => {
        // No account_id, ever, on this path — FL-extract data is research-track
        // only (D-027) and the migration-012 CHECK enforces it.
        const res = await client.query<{ id: string }>(
          `INSERT INTO voter_uploads (user_id, filename, row_count, status, history_filename, ballot_favors)
           VALUES ($1, $2, $3, 'pending', $4, $5)
           RETURNING id`,
          [userEmail, filename, records.length, historyFilename, ballotFavors],
        );
        return res.rows[0].id;
      });
      console.log(`Created upload ${uploadId} (status pending until all rows land)`);
    }

    const t0 = Date.now();
    let withHistory = 0;
    for (let start = startIndex; start < records.length; start += chunkSize) {
      const slice = records.slice(start, start + chunkSize);
      withHistory += await inUserTxn(pool, userEmail, (client) =>
        insertVoterRecords(client, {
          uploadId,
          userEmail,
          records: slice,
          startIndex: start,
          historyMap,
        }),
      );
      const done = Math.min(start + chunkSize, records.length);
      const elapsed = (Date.now() - t0) / 1000;
      const rate = (done - startIndex) / Math.max(elapsed, 0.001);
      const etaMin = (records.length - done) / Math.max(rate, 1) / 60;
      console.log(
        `  ${done.toLocaleString()}/${records.length.toLocaleString()} rows · ${Math.round(rate).toLocaleString()}/s · ETA ${etaMin.toFixed(1)} min`,
      );
    }

    await inUserTxn(pool, userEmail, (client) =>
      client.query(`UPDATE voter_uploads SET status = 'ready' WHERE id = $1`, [uploadId]),
    );

    console.log(
      `\nDone. Upload ${uploadId} READY — ${records.length.toLocaleString()} voters` +
        (historyFilename ? `, ${withHistory.toLocaleString()} with history (this run)` : '') +
        `.\nNext (county scale): npx tsx scripts/run-fec-index.ts --upload-id ${uploadId}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
