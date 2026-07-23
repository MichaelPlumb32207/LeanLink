/**
 * Inning 1 — Registration lean (party prior) for GOTV uploads.
 *
 * Does NOT write fusion/lean_results (party is a product prior; donation arms
 * remain the evidence path). Reports counts per county for Client 1 / Client 2.
 *
 *   npx tsx scripts/run-inning-registration.ts
 *   npx tsx scripts/run-inning-registration.ts --counties CAL,ALA,DUV
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
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

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function regLean(party: string): 'Left' | 'Right' | 'none' {
  const p = (party || '').toUpperCase();
  if (p === 'DEM') return 'Left';
  if (p === 'REP') return 'Right';
  return 'none';
}

async function main() {
  loadEnvLocal();
  const email = process.env.ALLOWED_USER_EMAIL!;
  const want = (arg('--counties') ?? 'CAL,ALA,DUV')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

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
      history_filename: string | null;
      uni: string | null;
    }>(
      `SELECT id, filename, row_count, history_filename,
              ingest_universe->>'preset' AS uni
       FROM voter_uploads
       WHERE user_id = $1 AND status = 'ready' AND filename ~* '^(CAL|ALA|DUV)_'
       ORDER BY created_at DESC`,
      [email],
    );

    const best: Record<string, (typeof uploads.rows)[0]> = {};
    for (const u of uploads.rows) {
      const code = u.filename.slice(0, 3).toUpperCase();
      if (!want.includes(code)) continue;
      const score = (x: typeof u) =>
        (x.filename.includes('20260714') ? 100 : 0) +
        (x.uni === 'gotv' ? 10 : 0) +
        Math.log10(x.row_count + 1) +
        (x.history_filename ? 1 : 0);
      if (!best[code] || score(u) > score(best[code])) best[code] = u;
    }

    const results: Record<string, unknown> = {
      inning: 1,
      name: 'registration_lean',
      generated: new Date().toISOString(),
      note:
        'Party prior only (DEM→Left, REP→Right). No fusion/lean_results writes. NPA stays unlabeled until donation/OSINT arms.',
      counties: {} as Record<string, unknown>,
    };

    console.log('\n=== INNING 1 · Registration lean (party prior) ===\n');

    for (const code of want) {
      const u = best[code];
      if (!u) {
        console.log(`${code}: NO UPLOAD`);
        continue;
      }
      const hist = await client.query<{ n: number; with_hist: number }>(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE history_summary IS NOT NULL)::int AS with_hist
         FROM voter_records WHERE upload_id = $1`,
        [u.id],
      );
      const parties = await client.query<{ party: string; n: number }>(
        `SELECT coalesce(raw_data->>'party','?') AS party, count(*)::int AS n
         FROM voter_records WHERE upload_id = $1 GROUP BY 1 ORDER BY n DESC`,
        [u.id],
      );

      let left = 0;
      let right = 0;
      let none = 0;
      const mix: Record<string, number> = {};
      for (const r of parties.rows) {
        mix[r.party] = r.n;
        const L = regLean(r.party);
        if (L === 'Left') left += r.n;
        else if (L === 'Right') right += r.n;
        else none += r.n;
      }
      const n = hist.rows[0].n;
      const labeled = left + right;
      const pct = n ? ((100 * labeled) / n).toFixed(1) : '0';

      (results.counties as Record<string, unknown>)[code] = {
        upload_id: u.id,
        filename: u.filename,
        universe: u.uni,
        rows: n,
        with_history: hist.rows[0].with_hist,
        left,
        right,
        no_party_lean: none,
        labeled,
        labeled_pct: Number(pct),
        party_mix: mix,
      };

      console.log(`${code} · ${u.filename} · ${u.uni}`);
      console.log(`  rows ${n.toLocaleString()} · history ${hist.rows[0].with_hist.toLocaleString()}`);
      console.log(
        `  reg lean: Left ${left.toLocaleString()} · Right ${right.toLocaleString()} · none ${none.toLocaleString()} (${pct}% labeled)`,
      );
      console.log('');
    }

    const dir = join(process.cwd(), 'docs', 'innings-runs');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `inning-1-registration-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify(results, null, 2));
    writeFileSync(join(dir, 'inning-1-registration-latest.json'), JSON.stringify(results, null, 2));
    console.log(`Wrote ${path}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
