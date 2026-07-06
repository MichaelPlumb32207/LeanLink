/**
 * ONE-OFF cleanup (ENH-012 follow-up): the first tightened Sunbiz re-pass left
 * stale pre-gate evidence events for voters that no longer match — the runner
 * only wrote/updated events for voters WITH a hit, and didn't supersede the old
 * event when a voter stopped matching. The code gap is fixed going forward
 * (lib/evidence/ledger.ts `deleteVoterArmEvents` + lib/free-pass/run-voter.ts);
 * this script reconciles the rows already in the DB for the Duval upload.
 *
 * Deletes, scoped to source + stale scorer_v (< current), so nothing fresh is touched:
 *   - stale `sunbiz_index` events   (no lean → no re-fuse needed)
 *   - stale `fl_contrib_entity` events (layer-2); re-fuses only the voters whose
 *     stale layer-2 carried a real lean, so lean_results stay consistent.
 * Verified safe: 0 stale rows sit on settled/accepted voters (checked before delete).
 *
 * Usage:
 *   npx tsx scripts/cleanup-stale-sunbiz.ts            # DRY RUN — reports, changes nothing
 *   npx tsx scripts/cleanup-stale-sunbiz.ts --commit   # apply (single atomic transaction)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { fuseAndPersistVoter } from '@/lib/evidence/ledger';
import { SCORER_VERSION } from '@/lib/evidence/scorer-version';

const UPLOAD_ID = '2036da1e-6e15-49d4-93a4-718a5e744aae'; // Duval

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

async function main() {
  const commit = process.argv.includes('--commit');
  loadEnvLocal();
  const email = process.env.ALLOWED_USER_EMAIL;
  if (!email || !process.env.DATABASE_URL) throw new Error('ALLOWED_USER_EMAIL / DATABASE_URL required in .env.local');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  const q = (s: string, p: unknown[] = []) => c.query(s, p);
  const stale = `(payload->>'scorer_v') IS DISTINCT FROM '${SCORER_VERSION}'`;
  try {
    await q('BEGIN');
    await q(`SELECT set_config('app.current_user',$1,true)`, [email]);

    const onFrozen = await q(
      `SELECT count(*) n FROM evidence_events ee JOIN voter_lean_fusion f ON f.voter_record_id=ee.voter_record_id
       WHERE ee.upload_id=$1 AND ee.source IN ('sunbiz_index','fl_contrib_entity') AND ${stale}
         AND (f.settled_tier IS NOT NULL OR f.review_status='accepted')`,
      [UPLOAD_ID],
    );
    if (Number(onFrozen.rows[0].n) > 0) throw new Error(`ABORT: ${onFrozen.rows[0].n} stale rows sit on settled/accepted voters — investigate before deleting.`);

    const cSun = await q(`SELECT count(*) n FROM evidence_events WHERE upload_id=$1 AND source='sunbiz_index' AND ${stale}`, [UPLOAD_ID]);
    const cL2 = await q(`SELECT count(*) n FROM evidence_events WHERE upload_id=$1 AND source='fl_contrib_entity' AND ${stale}`, [UPLOAD_ID]);
    const leanVoters = await q(
      `SELECT DISTINCT voter_record_id FROM evidence_events
       WHERE upload_id=$1 AND source='fl_contrib_entity' AND ${stale} AND lean_signal IS NOT NULL AND lean_signal<>'Undetermined'`,
      [UPLOAD_ID],
    );
    console.log(`stale sunbiz_index:      ${cSun.rows[0].n}`);
    console.log(`stale fl_contrib_entity: ${cL2.rows[0].n}  (re-fuse ${leanVoters.rows.length} lean-carrying voters)`);

    if (!commit) {
      console.log('\nDRY RUN — no changes. Re-run with --commit to apply.');
      await q('ROLLBACK');
      return;
    }

    const dSun = await q(`DELETE FROM evidence_events WHERE upload_id=$1 AND source='sunbiz_index' AND ${stale}`, [UPLOAD_ID]);
    const dL2 = await q(`DELETE FROM evidence_events WHERE upload_id=$1 AND source='fl_contrib_entity' AND ${stale}`, [UPLOAD_ID]);
    console.log(`deleted sunbiz=${dSun.rowCount} layer-2=${dL2.rowCount}`);
    let done = 0;
    for (const r of leanVoters.rows) {
      await fuseAndPersistVoter(c, (r as { voter_record_id: string }).voter_record_id, UPLOAD_ID, email);
      if (++done % 150 === 0) console.log(`  re-fused ${done}/${leanVoters.rows.length}`);
    }

    const confirmed = await q(`SELECT count(DISTINCT voter_record_id) n FROM evidence_events WHERE upload_id=$1 AND arm='sunbiz' AND probable_same_person=true`, [UPLOAD_ID]);
    console.log(`re-fused ${done} voters. AFTER: sunbiz confirmed = ${confirmed.rows[0].n}`);
    await q('COMMIT');
    console.log('COMMITTED.');
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
