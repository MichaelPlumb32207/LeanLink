/**
 * FEC federal individual-contributions bulk import (Florida-filtered).
 *
 * Reads the FEC bulk "indiv" file (pipe-delimited, 21 columns, no header —
 * format verified against fec.gov/campaign-finance-data/contributions-individuals-file-description/
 * on 2026-07-04) plus the cycle's committee master (cm file, 15 columns), keeps
 * rows with STATE = FL and ENTITY_TP = IND (or blank), and loads them into
 * `fec_contributions` under a `reference_snapshots` row (source 'fec_indiv').
 *
 * Differences from the fl-contrib/sunbiz importers, both deliberate:
 *  - **Autocommit batches instead of one big transaction** — a cycle is ~4–5M FL
 *    rows (~30 min over the wire). The unique (snapshot_id, sub_id) index +
 *    ON CONFLICT DO NOTHING make re-runs resume where they left off instead of
 *    starting over. `fresh: true` deletes the snapshot's rows first.
 *  - **Live progress in the snapshot row** — row_count and a notes JSON
 *    ({state, lines_read, pct, rate, updated_at…}) update as the load runs, so
 *    `scripts/fec-indiv-status.mjs` can report progress from any terminal.
 *    Lookups ignore the snapshot until `completed_at` is set at the end.
 */
import { createReadStream, statSync } from 'fs';
import { createInterface } from 'readline';
import { Pool } from 'pg';
import { fecNameNorm, zip5 } from '@/lib/reference-data/normalize';

const INDIV_COLUMNS = 21;
const CM_COLUMNS = 15;

/** MMDDYYYY → YYYY-MM-DD, or null when absent/malformed. */
function parseFecDate(raw: string): string | null {
  const t = raw.trim();
  if (!/^\d{8}$/.test(t)) return null;
  const mm = t.slice(0, 2);
  const dd = t.slice(2, 4);
  const yyyy = t.slice(4);
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  return `${yyyy}-${mm}-${dd}`;
}

async function loadCommitteeMaster(
  filePath: string,
): Promise<Map<string, { name: string; party: string | null }>> {
  const map = new Map<string, { name: string; party: string | null }>();
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    const cols = line.split('|');
    if (cols.length < CM_COLUMNS) continue;
    const id = cols[0].trim();
    if (!id) continue;
    map.set(id, {
      name: cols[1].trim() || id,
      party: cols[10].trim() || null,
    });
  }
  return map;
}

export interface FecIndivImportResult {
  snapshot_id: string;
  label: string;
  lines_read: number;
  fl_rows_kept: number;
  inserted: number;
  skipped_existing: number;
  malformed_lines: number;
  committees_loaded: number;
  total_rows_in_snapshot: number;
}

export async function importFecIndiv(params: {
  filePath: string;
  committeesPath: string;
  label: string;
  fresh?: boolean;
  batchSize?: number;
}): Promise<FecIndivImportResult> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set');
  const batchSize = params.batchSize ?? 500;

  const committees = await loadCommitteeMaster(params.committeesPath);
  console.log(`[cm] ${committees.size.toLocaleString()} committees loaded`);

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
  const client = await pool.connect();
  const startedAt = Date.now();
  const fileBytes = statSync(params.filePath).size;

  try {
    // Snapshot row up front (autocommit) so progress is visible immediately.
    // Lookups ignore it until completed_at is set at the very end.
    const snap = await client.query<{ id: string }>(
      `INSERT INTO reference_snapshots (source, label, row_count, completed_at)
       VALUES ('fec_indiv', $1, 0, NULL)
       ON CONFLICT (source, label) DO UPDATE SET completed_at = NULL
       RETURNING id`,
      [params.label],
    );
    const snapshotId = snap.rows[0].id;

    if (params.fresh) {
      console.log('[fresh] deleting existing rows for this snapshot…');
      await client.query(`DELETE FROM fec_contributions WHERE snapshot_id = $1`, [snapshotId]);
    }

    let linesRead = 0;
    let bytesRead = 0;
    let kept = 0;
    let inserted = 0;
    let malformed = 0;
    let batch: unknown[][] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const placeholders: string[] = [];
      const values: unknown[] = [];
      let p = 1;
      for (const row of batch) {
        placeholders.push(
          `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
        );
        values.push(...row);
      }
      const res = await client.query(
        `INSERT INTO fec_contributions
           (snapshot_id, sub_id, cmte_id, committee_name, committee_party,
            contributor_name, contributor_name_norm, city, state, zip5,
            employer, occupation, amount, contribution_date, transaction_tp, memo_cd)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (snapshot_id, sub_id) DO NOTHING`,
        values,
      );
      inserted += res.rowCount ?? 0;
      batch = [];
    };

    const progressNote = (state: 'loading' | 'ready') =>
      JSON.stringify({
        state,
        lines_read: linesRead,
        fl_rows_kept: kept,
        inserted,
        pct: Math.min(100, Math.round((bytesRead / fileBytes) * 100)),
        rate_lines_per_s: Math.round(linesRead / Math.max(1, (Date.now() - startedAt) / 1000)),
        started_at: new Date(startedAt).toISOString(),
        updated_at: new Date().toISOString(),
      });

    const updateProgress = async (state: 'loading' | 'ready' = 'loading') => {
      await client.query(
        `UPDATE reference_snapshots SET row_count = $2, notes = $3 WHERE id = $1`,
        [snapshotId, inserted, progressNote(state)],
      );
    };

    const rl = createInterface({
      input: createReadStream(params.filePath),
      crlfDelay: Infinity,
    });

    let lastProgressAt = 0;
    for await (const line of rl) {
      linesRead += 1;
      bytesRead += line.length + 1;
      const cols = line.split('|');
      if (cols.length !== INDIV_COLUMNS) {
        malformed += 1;
        continue;
      }
      // Columns (0-based): 0 CMTE_ID · 5 TRANSACTION_TP · 6 ENTITY_TP · 7 NAME ·
      // 8 CITY · 9 STATE · 10 ZIP_CODE · 11 EMPLOYER · 12 OCCUPATION ·
      // 13 TRANSACTION_DT · 14 TRANSACTION_AMT · 18 MEMO_CD · 20 SUB_ID
      if (cols[9].trim().toUpperCase() !== 'FL') continue;
      const entity = cols[6].trim().toUpperCase();
      if (entity && entity !== 'IND') continue;
      const name = cols[7].trim();
      const subId = cols[20].trim();
      if (!name || !/^\d+$/.test(subId)) {
        malformed += 1;
        continue;
      }
      kept += 1;

      const cmte = committees.get(cols[0].trim());
      const amountRaw = Number(cols[14]);
      batch.push([
        snapshotId,
        subId,
        cols[0].trim() || null,
        cmte?.name ?? null,
        cmte?.party ?? null,
        name,
        fecNameNorm(name),
        cols[8].trim() || null,
        'FL',
        zip5(cols[10]) || null,
        cols[11].trim() || null,
        cols[12].trim() || null,
        Number.isFinite(amountRaw) ? amountRaw : null,
        parseFecDate(cols[13]),
        cols[5].trim() || null,
        cols[18].trim() || null,
      ]);
      if (batch.length >= batchSize) await flush();

      if (linesRead % 250_000 === 0) {
        const pct = Math.min(100, Math.round((bytesRead / fileBytes) * 100));
        const rate = Math.round(linesRead / Math.max(1, (Date.now() - startedAt) / 1000));
        const etaMin = Math.round(((fileBytes - bytesRead) / (bytesRead / ((Date.now() - startedAt) / 1000))) / 60);
        console.log(
          `[indiv] ${(linesRead / 1e6).toFixed(1)}M lines · ${kept.toLocaleString()} FL kept · ` +
            `${inserted.toLocaleString()} inserted · ${pct}% · ${rate.toLocaleString()} lines/s · ~${etaMin} min left`,
        );
      }
      if (Date.now() - lastProgressAt > 30_000) {
        lastProgressAt = Date.now();
        await updateProgress('loading');
      }
    }
    await flush();

    await client.query(
      `UPDATE reference_snapshots
       SET row_count = (SELECT COUNT(*) FROM fec_contributions WHERE snapshot_id = $1),
           notes = $2,
           imported_at = NOW(),
           completed_at = NOW()
       WHERE id = $1`,
      [snapshotId, progressNote('ready')],
    );

    const finalCount = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fec_contributions WHERE snapshot_id = $1`,
      [snapshotId],
    );
    const total = Number(finalCount.rows[0].count);

    return {
      snapshot_id: snapshotId,
      label: params.label,
      lines_read: linesRead,
      fl_rows_kept: kept,
      inserted,
      skipped_existing: kept - inserted,
      malformed_lines: malformed,
      committees_loaded: committees.size,
      total_rows_in_snapshot: total,
    };
  } finally {
    client.release();
    await pool.end();
  }
}
