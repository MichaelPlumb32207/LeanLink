/**
 * Build innings-style metrics for client demo (registration lean → donation lean → …).
 *   npx tsx scripts/build-innings-demo.ts
 *
 * Writes docs/demo-innings-data.json (gitignored with other demos).
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import pg from 'pg';

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
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

type PartyLean = 'Left' | 'Right' | 'none';

function regLean(party: string): PartyLean {
  const p = (party || '').toUpperCase();
  if (p === 'DEM') return 'Left';
  if (p === 'REP') return 'Right';
  return 'none';
}

async function main() {
  loadEnvLocal();
  const email = process.env.ALLOWED_USER_EMAIL!;
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
    max: 2,
  });
  const client = await pool.connect();

  try {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [email]);

    // Prefer latest ready upload per county code prefix
    const uploads = await client.query<{
      id: string;
      filename: string;
      row_count: number;
      history_filename: string | null;
      uni: string | null;
      created_at: Date;
    }>(
      `SELECT id, filename, row_count, history_filename,
              ingest_universe->>'preset' AS uni, created_at
       FROM voter_uploads
       WHERE user_id = $1 AND status = 'ready'
         AND filename ~* '^(CAL|ALA|DUV)_'
       ORDER BY created_at DESC`,
      [email],
    );

    const best: Record<string, (typeof uploads.rows)[0]> = {};
    for (const u of uploads.rows) {
      const code = u.filename.slice(0, 3).toUpperCase();
      const score = (x: typeof u) =>
        (x.filename.includes('20260714') ? 100 : 0) +
        (x.uni === 'gotv' ? 10 : 0) +
        Math.log10(x.row_count + 1) +
        (x.history_filename ? 1 : 0);
      if (!best[code] || score(u) > score(best[code])) best[code] = u;
    }

    const counties: Record<string, unknown> = {};

    for (const code of ['CAL', 'ALA', 'DUV']) {
      const u = best[code];
      if (!u) {
        counties[code] = { error: 'no upload' };
        continue;
      }
      console.log('Innings for', code, u.filename, u.id);

      const hist = await client.query<{ n: number; with_hist: number }>(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE history_summary IS NOT NULL)::int AS with_hist
         FROM voter_records WHERE upload_id = $1`,
        [u.id],
      );

      // Inning 0 / registration lean (party prior product concept)
      const reg = await client.query<{
        party: string;
        status: string;
        n: number;
      }>(
        `SELECT coalesce(raw_data->>'party','?') AS party,
                coalesce(raw_data->>'status','?') AS status,
                count(*)::int AS n
         FROM voter_records WHERE upload_id = $1
         GROUP BY 1, 2`,
        [u.id],
      );

      let regLeft = 0;
      let regRight = 0;
      let regNone = 0;
      const partyMix: Record<string, number> = {};
      for (const r of reg.rows) {
        partyMix[r.party] = (partyMix[r.party] ?? 0) + r.n;
        const L = regLean(r.party);
        if (L === 'Left') regLeft += r.n;
        else if (L === 'Right') regRight += r.n;
        else regNone += r.n;
      }

      // Evidence / fusion innings
      const arms = await client.query<{ arm: string; n: number; with_lean: number }>(
        `SELECT arm,
                count(*)::int AS n,
                count(*) FILTER (
                  WHERE lean_signal IS NOT NULL AND lean_signal <> 'Undetermined'
                )::int AS with_lean
         FROM evidence_events
         WHERE upload_id = $1
         GROUP BY arm
         ORDER BY n DESC`,
        [u.id],
      );

      const fusion = await client.query<{
        n: number;
        settled: number;
        left: number;
        right: number;
        ind: number;
        und: number;
        conflicted: number;
      }>(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE settled_tier IS NOT NULL)::int AS settled,
                count(*) FILTER (WHERE lean = 'Left')::int AS left,
                count(*) FILTER (WHERE lean = 'Right')::int AS right,
                count(*) FILTER (WHERE lean = 'Independent')::int AS ind,
                count(*) FILTER (WHERE lean = 'Undetermined' OR lean IS NULL)::int AS und,
                count(*) FILTER (WHERE fusion_status = 'conflicted')::int AS conflicted
         FROM voter_lean_fusion WHERE upload_id = $1`,
        [u.id],
      );

      const settledByArm = await client.query<{ arm: string; n: number }>(
        `SELECT coalesce(settled_arm, '(none)') AS arm, count(*)::int AS n
         FROM voter_lean_fusion
         WHERE upload_id = $1 AND settled_tier IS NOT NULL
         GROUP BY 1 ORDER BY n DESC`,
        [u.id],
      );

      // Where registration party and fused lean disagree (donation can "override" or conflict)
      const disagree = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM voter_records vr
         JOIN voter_lean_fusion f ON f.voter_record_id = vr.id
         WHERE vr.upload_id = $1
           AND f.lean IS NOT NULL AND f.lean NOT IN ('Undetermined')
           AND (
             (vr.raw_data->>'party' = 'DEM' AND f.lean = 'Right')
             OR (vr.raw_data->>'party' = 'REP' AND f.lean = 'Left')
           )`,
        [u.id],
      );

      const agree = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM voter_records vr
         JOIN voter_lean_fusion f ON f.voter_record_id = vr.id
         WHERE vr.upload_id = $1
           AND f.lean IS NOT NULL AND f.lean NOT IN ('Undetermined')
           AND (
             (vr.raw_data->>'party' = 'DEM' AND f.lean = 'Left')
             OR (vr.raw_data->>'party' = 'REP' AND f.lean = 'Right')
           )`,
        [u.id],
      );

      // NPA with donation lean
      const npaWithLean = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM voter_records vr
         JOIN voter_lean_fusion f ON f.voter_record_id = vr.id
         WHERE vr.upload_id = $1
           AND vr.raw_data->>'party' = 'NPA'
           AND f.lean IS NOT NULL AND f.lean NOT IN ('Undetermined')`,
        [u.id],
      );

      counties[code] = {
        upload_id: u.id,
        filename: u.filename,
        universe: u.uni,
        history_filename: u.history_filename,
        rows: hist.rows[0].n,
        with_history: hist.rows[0].with_hist,
        innings: {
          input: {
            source: 'FL DOS registration extract + optional history',
            universe: u.uni,
            rows: hist.rows[0].n,
            with_history: hist.rows[0].with_hist,
          },
          registration_lean: {
            note:
              'Product prior: DEM→Left, REP→Right. Not the same as fusion settle; party is not auto-written as an evidence event on FL extracts today (party_prior is tier-0 when provided at generic intake).',
            left: regLeft,
            right: regRight,
            no_party_lean: regNone,
            labeled: regLeft + regRight,
            labeled_pct:
              hist.rows[0].n > 0
                ? Number((((regLeft + regRight) / hist.rows[0].n) * 100).toFixed(1))
                : 0,
            party_mix: partyMix,
          },
          donation_arms: {
            note:
              'FEC (tier 1) and FL contrib/Sunbiz (tier 2). Fusion weights FEC higher than FL person match; conflicts within 1.4× score → Undetermined. Settlement uses cheapest contributing tier (party_prior 0 < fec 1 < fl 2 < osint 3).',
            evidence_by_arm: arms.rows,
            fusion: fusion.rows[0],
            settled_by_arm: settledByArm.rows,
            reg_vs_fusion: {
              agree_party_and_fusion: agree.rows[0].n,
              disagree_party_vs_fusion: disagree.rows[0].n,
              npa_with_determinate_fusion: npaWithLean.rows[0].n,
            },
            ran:
              arms.rows.length > 0 ||
              (fusion.rows[0]?.n ?? 0) > 0,
          },
        },
      };
    }

    const out = {
      generated: new Date().toISOString(),
      fusion_override_rules: {
        summary:
          'Donations do not hard-delete registration party. Fusion scores lean *signals from evidence events*. Registration party on FL extracts is a separate product prior unless a party_prior event is written. If both party and donations ever contribute opposing leans, close scores → conflicted/Undetermined; a strong FEC signal can dominate a weak opposing signal.',
        settle_threshold: Number(process.env.LEANLINK_SETTLE_THRESHOLD ?? 60),
        arm_tiers: { party_prior: 0, fec: 1, fl_contrib: 2, sunbiz: 2, osint: 3 },
      },
      counties,
    };

    writeFileSync(
      join(process.cwd(), 'docs/demo-innings-data.json'),
      JSON.stringify(out, null, 2),
    );
    console.log('Wrote docs/demo-innings-data.json');
    for (const code of ['CAL', 'ALA', 'DUV']) {
      const c = counties[code] as {
        rows: number;
        with_history: number;
        universe: string;
        innings: {
          registration_lean: { labeled: number; labeled_pct: number };
          donation_arms: { ran: boolean; fusion: { settled: number } };
        };
      };
      if (!c?.rows) continue;
      console.log(
        code,
        'rows',
        c.rows,
        'hist',
        c.with_history,
        'uni',
        c.universe,
        'regLean%',
        c.innings.registration_lean.labeled_pct,
        'donationRan',
        c.innings.donation_arms.ran,
        'settled',
        c.innings.donation_arms.fusion?.settled,
      );
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
