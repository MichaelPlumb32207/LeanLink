/**
 * Audit Calhoun (or any) layer-2 entity FL contrib events + committee names.
 * Usage: npx tsx scripts/audit-layer2.ts [--county CAL]
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { inferLeanFromFlContributions } from '@/lib/fl-contrib/donation-lean';
import { lookupFlContributionsByEntityName } from '@/lib/fl-contrib/lookup';
import type { FlContributionHit } from '@/lib/fl-contrib/types';

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
  const county = process.argv.includes('--county')
    ? process.argv[process.argv.indexOf('--county') + 1] ?? 'CAL'
    : 'CAL';
  const user = process.env.ALLOWED_USER_EMAIL;
  if (!user) throw new Error('ALLOWED_USER_EMAIL required');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
  const client = await pool.connect();

  try {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [user]);

    const uploadRes = await client.query<{ id: string; filename: string }>(
      `SELECT id, filename FROM voter_uploads
       WHERE filename ILIKE $1
       ORDER BY created_at DESC LIMIT 1`,
      [`%${county}%`],
    );
    const upload = uploadRes.rows[0];
    if (!upload) {
      console.error(`No upload for county ${county}`);
      process.exit(1);
    }
    console.log(`Upload: ${upload.filename} (${upload.id})\n`);

    const events = await client.query<{
      row_index: number;
      voter_name: string;
      voter_record_id: string;
      entity_name: string | null;
      identity_band: string | null;
      identity_score: number | null;
      probable_same_person: boolean;
      lean_signal: string | null;
      evidence: string[];
      hit_count: number | null;
    }>(
      `SELECT vr.row_index,
              vr.raw_data->'name'->>'full' AS voter_name,
              vr.id AS voter_record_id,
              ee.payload->>'entity_name' AS entity_name,
              (ee.payload->>'hit_count')::int AS hit_count,
              ee.identity_band,
              ee.identity_score,
              ee.probable_same_person,
              ee.lean_signal,
              ee.evidence
       FROM evidence_events ee
       JOIN voter_records vr ON vr.id = ee.voter_record_id
       WHERE ee.upload_id = $1 AND ee.source = 'fl_contrib_entity'
       ORDER BY vr.row_index`,
      [upload.id],
    );

    console.log(`Layer-2 voters: ${events.rowCount}\n`);

    const snapRes = await client.query<{ id: string }>(
      `SELECT id FROM reference_snapshots WHERE source = 'fl_contrib' ORDER BY imported_at DESC LIMIT 1`,
    );
    const flSnapshotId = snapRes.rows[0]?.id;

    for (const ev of events.rows) {
      const sunbiz = await client.query<{ payload: { entities?: { corp_name: string }[] } }>(
        `SELECT payload FROM evidence_events
         WHERE voter_record_id = $1 AND arm = 'sunbiz' LIMIT 1`,
        [ev.voter_record_id],
      );
      const corps =
        sunbiz.rows[0]?.payload?.entities?.map((e) => e.corp_name).filter(Boolean) ?? [];

      let hits: FlContributionHit[] = [];
      const entityNames = [...new Set([ev.entity_name, ...corps].filter(Boolean))] as string[];
      if (flSnapshotId && entityNames.length > 0) {
        for (const corp of entityNames.slice(0, 3)) {
          const found = await lookupFlContributionsByEntityName({
            client,
            snapshotId: flSnapshotId,
            entityName: corp,
          });
          hits.push(...found);
        }
        hits = [...new Map(hits.map((h) => [h.id, h])).values()];
      }

      const hypotheticalLean = inferLeanFromFlContributions(hits, {
        layer: 2,
        entity_name: ev.entity_name ?? corps[0] ?? undefined,
      });

      const committees = [...new Set(hits.map((h) => h.committee_name).filter(Boolean))];

      console.log(`Row ${ev.row_index} · ${ev.voter_name}`);
      console.log(`  Entity (event): ${ev.entity_name ?? '—'}`);
      console.log(`  Sunbiz corps: ${corps.join(' · ') || '—'}`);
      console.log(`  Identity: ${ev.identity_band} (${ev.identity_score}) · probable_same_person=${ev.probable_same_person}`);
      console.log(`  Stored lean_signal: ${ev.lean_signal}`);
      console.log(`  FL hits (stored): ${ev.hit_count ?? '?'}`);
      console.log(`  FL hits (re-query): ${hits.length}`);
      if (ev.evidence.length) {
        console.log('  Stored evidence:');
        for (const line of ev.evidence) console.log(`    ${line}`);
      }
      if (committees.length) {
        console.log(`  Committees (${committees.length} unique):`);
        for (const c of committees.slice(0, 8)) console.log(`    - ${c}`);
        if (committees.length > 8) console.log(`    … +${committees.length - 8} more`);
      }
      console.log(
        `  If lean ran anyway: ${hypotheticalLean.lean} (${hypotheticalLean.lean_signals_found ? hypotheticalLean.confidence + '%' : 'no signal'})`,
      );
      if (hypotheticalLean.evidence.length) {
        for (const line of hypotheticalLean.evidence.slice(0, 4)) {
          console.log(`    ${line}`);
        }
      }
      console.log('');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});