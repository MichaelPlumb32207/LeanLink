/**
 * One-shot: sample 50-name client list + multi-county priority summary for demo HTML.
 *   npx tsx scripts/build-client-demo-data.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import pg from 'pg';
import { assignPriorityTier, type CampaignSide } from '@/lib/priority/tiers';
import type { VoterHistorySummary } from '@/lib/fl-voter-history';

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

async function tierCounts(
  client: pg.PoolClient,
  uploadId: string,
  side: CampaignSide,
) {
  const counts: Record<string, number> = {
    A_core_gotv: 0,
    B_inactive_chase: 0,
    C_npa_expand: 0,
    D_base_remind: 0,
    E_npa_soft: 0,
    F_other_party: 0,
    G_thin: 0,
  };
  let offset = 0;
  let n = 0;
  for (;;) {
    const { rows } = await client.query<{
      party: string;
      status: string;
      email: string | null;
      phone: string | null;
      history_summary: VoterHistorySummary | null;
    }>(
      `SELECT coalesce(raw_data->>'party','') AS party,
              coalesce(raw_data->>'status','') AS status,
              nullif(trim(raw_data->>'email'),'') AS email,
              nullif(trim(raw_data->>'phone'),'') AS phone,
              history_summary
       FROM voter_records WHERE upload_id=$1
       ORDER BY row_index OFFSET $2 LIMIT 8000`,
      [uploadId, offset],
    );
    if (!rows.length) break;
    for (const row of rows) {
      n++;
      const t = row.history_summary?.turnout_propensity ?? null;
      const r = assignPriorityTier(
        {
          party: row.party,
          status: row.status,
          turnoutPropensity: t as 'High' | 'Medium' | 'Low' | null,
          hasEmail: !!row.email,
          hasPhone: !!row.phone,
          hasHistory: !!row.history_summary,
        },
        side,
      );
      counts[r.tier]++;
    }
    offset += rows.length;
    if (rows.length < 8000) break;
  }
  return {
    n,
    counts,
    chase: counts.A_core_gotv + counts.B_inactive_chase + counts.C_npa_expand,
  };
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
    const uploads = await client.query<{
      id: string;
      filename: string;
      row_count: number;
      ingest_universe: { preset?: string } | null;
    }>(
      `SELECT id, filename, row_count, ingest_universe
       FROM voter_uploads WHERE user_id=$1 AND status='ready'
       ORDER BY created_at DESC`,
      [email],
    );

    const byCounty: Record<
      string,
      { id: string; filename: string; row_count: number; ingest_universe: { preset?: string } | null }
    > = {};
    for (const u of uploads.rows) {
      const m = u.filename.match(/^(CAL|ALA|DUV)/i);
      if (!m) continue;
      const code = m[1].toUpperCase();
      const score = (x: typeof u) =>
        (x.filename.includes('20260714') ? 10 : 0) + Math.log10(x.row_count + 1);
      if (!byCounty[code] || score(u) > score(byCounty[code])) byCounty[code] = u;
    }

    const sample: {
      county: string;
      name: string;
      city: string;
      zip: string;
      yob: string;
      address: string;
      _party: string;
      _status: string;
      _turnout: string | null;
      _has_email: boolean;
      _has_phone: boolean;
    }[] = [];

    for (const [code, u] of Object.entries(byCounty)) {
      const need = code === 'DUV' ? 16 : 17;
      const rows = await client.query<{
        name: string;
        city: string;
        zip: string;
        addr_prefix: string;
        dob: string;
        party: string;
        status: string;
        email: string | null;
        phone: string | null;
        turnout: string | null;
      }>(
        `SELECT raw_data->'name'->>'full' AS name,
                raw_data->'residence'->>'city' AS city,
                raw_data->'residence'->>'zip' AS zip,
                left(raw_data->'residence'->>'line1', 14) AS addr_prefix,
                raw_data->>'birthDate' AS dob,
                raw_data->>'party' AS party,
                raw_data->>'status' AS status,
                raw_data->>'email' AS email,
                raw_data->>'phone' AS phone,
                history_summary->>'turnout_propensity' AS turnout
         FROM voter_records
         WHERE upload_id = $1
           AND raw_data->'name'->>'last' IS NOT NULL
           AND length(raw_data->'name'->>'last') > 1
         ORDER BY md5(id::text || 'client-demo-v1')
         LIMIT $2`,
        [u.id, need],
      );
      for (const r of rows.rows) {
        const yob = (r.dob || '').match(/(\d{4})/)?.[1] || '';
        sample.push({
          county: code,
          name: r.name,
          city: r.city,
          zip: (r.zip || '').slice(0, 5),
          yob,
          address: r.addr_prefix ? `${String(r.addr_prefix).trim()}…` : '',
          _party: r.party,
          _status: r.status,
          _turnout: r.turnout,
          _has_email: Boolean(r.email?.trim()),
          _has_phone: Boolean(r.phone?.trim()),
        });
      }
    }

    function mockLean(p: (typeof sample)[0]) {
      if (p._party === 'DEM')
        return {
          lean: 'Left',
          confidence: 72,
          source: 'party_registration',
          note: 'Registered Democrat — strong prior (not OSINT)',
        };
      if (p._party === 'REP')
        return {
          lean: 'Right',
          confidence: 72,
          source: 'party_registration',
          note: 'Registered Republican — strong prior (not OSINT)',
        };
      if (p._party === 'NPA')
        return {
          lean: 'Undetermined',
          confidence: 25,
          source: 'npa_pending_public_arms',
          note: 'NPA; no FEC/FL settle in this demo — production would queue public arms',
        };
      return {
        lean: 'Undetermined',
        confidence: 30,
        source: 'minor_party',
        note: `Party ${p._party} on file`,
      };
    }

    const client2_deliverable = sample.map((p, i) => {
      const L = mockLean(p);
      return {
        row: i + 1,
        name: p.name,
        county: p.county,
        city: p.city,
        zip: p.zip,
        yob: p.yob,
        lean: L.lean,
        confidence: L.confidence,
        evidence_source: L.source,
        evidence_note: L.note,
        turnout: p._turnout || 'Unknown',
        contactable: p._has_email || p._has_phone ? 'yes' : 'no',
      };
    });

    const summary: Record<string, unknown> = {};
    for (const [code, u] of Object.entries(byCounty)) {
      console.log('Scoring', code, u.filename, '…');
      summary[code] = {
        id: u.id,
        filename: u.filename,
        rows: u.row_count,
        universe: u.ingest_universe?.preset ?? 'legacy',
        dem: await tierCounts(client, u.id, 'DEM'),
        rep: await tierCounts(client, u.id, 'REP'),
        note:
          code === 'DUV' && !u.filename.includes('20260714')
            ? 'NPA+ACT research extract only — not full GOTV (would expand after 2026 GOTV ingest)'
            : null,
      };
    }

    const multi = { dem_A: 0, dem_B: 0, dem_C: 0, rep_A: 0, rep_B: 0, rep_C: 0, universe: 0 };
    for (const code of ['CAL', 'ALA', 'DUV'] as const) {
      const s = summary[code] as {
        dem: { counts: Record<string, number>; chase: number };
        rep: { counts: Record<string, number> };
        rows: number;
      };
      if (!s) continue;
      multi.dem_A += s.dem.counts.A_core_gotv;
      multi.dem_B += s.dem.counts.B_inactive_chase;
      multi.dem_C += s.dem.counts.C_npa_expand;
      multi.rep_A += s.rep.counts.A_core_gotv;
      multi.rep_B += s.rep.counts.B_inactive_chase;
      multi.rep_C += s.rep.counts.C_npa_expand;
      multi.universe += s.rows;
    }

    const aList = await client.query(
      `SELECT raw_data->'name'->>'full' AS name,
              raw_data->'residence'->>'city' AS city,
              left(raw_data->'residence'->>'zip',5) AS zip,
              raw_data->>'party' AS party,
              history_summary->>'turnout_propensity' AS turnout,
              history_summary->>'turnout_score' AS turnout_score,
              CASE WHEN nullif(trim(raw_data->>'phone'),'') IS NOT NULL THEN 'phone'
                   WHEN nullif(trim(raw_data->>'email'),'') IS NOT NULL THEN 'email'
                   ELSE 'none' END AS contact_channel
       FROM voter_records
       WHERE upload_id = $1
         AND raw_data->>'party' = 'DEM'
         AND raw_data->>'status' = 'ACT'
         AND (history_summary->>'turnout_propensity' IS NULL
              OR history_summary->>'turnout_propensity' IN ('Low','Medium'))
         AND (nullif(trim(raw_data->>'email'),'') IS NOT NULL
              OR nullif(trim(raw_data->>'phone'),'') IS NOT NULL)
       ORDER BY md5(id::text || 'alist')
       LIMIT 10`,
      [byCounty.ALA.id],
    );

    const out = {
      generated: new Date().toISOString(),
      multi,
      summary,
      client2_input: sample.map(({ name, county, city, zip, yob, address }) => ({
        name,
        county,
        city,
        zip,
        yob,
        address,
      })),
      client2_deliverable,
      client1_alist_sample_dem_ala: aList.rows,
    };
    writeFileSync(
      join(process.cwd(), 'docs/demo-client-experience-data.json'),
      JSON.stringify(out, null, 2),
    );
    console.log('Wrote docs/demo-client-experience-data.json');
    console.log('multi', multi);
    console.log('client2 lean mix', {
      Left: client2_deliverable.filter((r) => r.lean === 'Left').length,
      Right: client2_deliverable.filter((r) => r.lean === 'Right').length,
      Undetermined: client2_deliverable.filter((r) => r.lean === 'Undetermined').length,
    });
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
