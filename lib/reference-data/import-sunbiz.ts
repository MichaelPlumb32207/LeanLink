import { corpNameNorm, officerNameNorm, parseSunbizCorLine } from '@/lib/sunbiz/parse-cor';
import { pool } from '@/lib/db';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

export async function importSunbizCorFile(params: {
  filePath: string;
  label: string;
  batchSize?: number;
}): Promise<{ snapshot_id: string; row_count: number }> {
  const batchSize = params.batchSize ?? 800;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const snap = await client.query<{ id: string }>(
      `INSERT INTO reference_snapshots (source, label, notes)
       VALUES ('sunbiz_cor', $1, $2)
       ON CONFLICT (source, label) DO UPDATE SET
         imported_at = NOW(),
         notes = EXCLUDED.notes
       RETURNING id`,
      [params.label, `import from ${params.filePath}`],
    );
    const snapshotId = snap.rows[0].id;

    await client.query(`DELETE FROM sunbiz_officers WHERE snapshot_id = $1`, [snapshotId]);

    const rl = createInterface({
      input: createReadStream(params.filePath, { encoding: 'latin1' }),
      crlfDelay: Infinity,
    });

    let rowCount = 0;
    let batch: unknown[][] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const placeholders: string[] = [];
      const values: unknown[] = [];
      let p = 1;
      for (const row of batch) {
        placeholders.push(
          `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
        );
        values.push(...row);
      }
      await client.query(
        `INSERT INTO sunbiz_officers
           (snapshot_id, corp_number, corp_name, corp_name_norm, corp_status, filing_type,
            principal_city, principal_zip5, officer_title, officer_type, officer_name,
            officer_name_norm, officer_city, officer_zip5, officer_address)
         VALUES ${placeholders.join(',')}`,
        values,
      );
      rowCount += batch.length;
      batch = [];
    };

    for await (const line of rl) {
      if (line.length < 500) continue;
      const officers = parseSunbizCorLine(line);
      for (const o of officers) {
        batch.push([
          snapshotId,
          o.corp_number,
          o.corp_name,
          corpNameNorm(o.corp_name),
          o.corp_status,
          o.filing_type,
          o.principal_city,
          o.principal_zip5,
          o.officer_title,
          o.officer_type,
          o.officer_name,
          officerNameNorm(o.officer_name),
          o.officer_city,
          o.officer_zip5,
          o.officer_address,
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
    return { snapshot_id: snapshotId, row_count: rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}