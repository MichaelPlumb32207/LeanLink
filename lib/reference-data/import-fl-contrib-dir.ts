import { contributorNameNorm, parseFlContribTsvLine } from '@/lib/fl-contrib/parse-tsv';
import { createReadStream } from 'fs';
import { Pool } from 'pg';
import { readdir } from 'fs/promises';
import { createInterface } from 'readline';
import { join } from 'path';

export async function importFlContribDirectory(params: {
  dirPath: string;
  label: string;
  dateFrom?: string;
  dateTo?: string;
  batchSize?: number;
}): Promise<{ snapshot_id: string; row_count: number; files: number }> {
  const batchSize = params.batchSize ?? 1000;
  const entries = await readdir(params.dirPath);
  const files = entries
    .filter((f) => f.endsWith('.tsv') && f.startsWith('flc_'))
    .sort()
    .map((f) => join(params.dirPath, f));

  if (files.length === 0) {
    throw new Error(`No flc_*.tsv files in ${params.dirPath}`);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const snap = await client.query<{ id: string }>(
      `INSERT INTO reference_snapshots (source, label, date_from, date_to, notes)
       VALUES ('fl_contrib', $1, $2::date, $3::date, $4)
       ON CONFLICT (source, label) DO UPDATE SET
         imported_at = NOW(),
         date_from = EXCLUDED.date_from,
         date_to = EXCLUDED.date_to,
         notes = EXCLUDED.notes
       RETURNING id`,
      [
        params.label,
        params.dateFrom ?? null,
        params.dateTo ?? null,
        `import ${files.length} files from ${params.dirPath}`,
      ],
    );
    const snapshotId = snap.rows[0].id;
    await client.query(`DELETE FROM fl_contributions WHERE snapshot_id = $1`, [snapshotId]);

    let rowCount = 0;
    let batch: unknown[][] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const placeholders: string[] = [];
      const values: unknown[] = [];
      let p = 1;
      for (const row of batch) {
        placeholders.push(
          `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
        );
        values.push(...row);
      }
      await client.query(
        `INSERT INTO fl_contributions
           (snapshot_id, contributor_name, contributor_name_norm, address, city, state, zip5,
            amount, contribution_date, committee_name, contribution_type, occupation, raw)
         VALUES ${placeholders.join(',')}`,
        values,
      );
      rowCount += batch.length;
      batch = [];
      if (rowCount % 50000 === 0) {
        console.log(`  …${rowCount.toLocaleString()} rows inserted`);
      }
    };

    for (const filePath of files) {
      const rl = createInterface({
        input: createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
      let lineNo = 0;
      for await (const line of rl) {
        lineNo += 1;
        const parsed = parseFlContribTsvLine(line, lineNo === 1);
        if (!parsed) continue;
        batch.push([
          snapshotId,
          parsed.contributor_name,
          contributorNameNorm(parsed.contributor_name),
          parsed.address,
          parsed.city,
          parsed.state,
          parsed.zip5,
          parsed.amount,
          parsed.contribution_date,
          parsed.committee_name,
          parsed.contribution_type,
          parsed.occupation,
          JSON.stringify(parsed),
        ]);
        if (batch.length >= batchSize) await flush();
      }
    }
    await flush();

    await client.query(
      `UPDATE reference_snapshots SET row_count = $2 WHERE id = $1`,
      [snapshotId, rowCount],
    );
    await client.query('COMMIT');
    return { snapshot_id: snapshotId, row_count: rowCount, files: files.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}