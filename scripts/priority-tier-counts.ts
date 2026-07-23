/**
 * Dry-run priority tier counts on an upload (no writes, no Exa).
 *
 *   npx tsx scripts/priority-tier-counts.ts --upload 16089ca5-…
 *   npx tsx scripts/priority-tier-counts.ts --county ALA
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import {
  PRIORITY_TIERS,
  assignPriorityTier,
  type CampaignSide,
  type PriorityTierId,
} from '@/lib/priority/tiers';
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

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadEnvLocal();
  const email = process.env.ALLOWED_USER_EMAIL;
  if (!email || !process.env.DATABASE_URL) {
    throw new Error('ALLOWED_USER_EMAIL + DATABASE_URL required');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
    max: 2,
  });
  const client = await pool.connect();

  try {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [email]);

    let uploadId = arg('--upload');
    if (!uploadId) {
      const county = (arg('--county') ?? 'ALA').toUpperCase();
      const up = await client.query<{ id: string; filename: string; row_count: number }>(
        `SELECT id, filename, row_count FROM voter_uploads
         WHERE user_id = $1 AND filename ILIKE $2 AND status = 'ready'
         ORDER BY created_at DESC LIMIT 1`,
        [email, `${county}%`],
      );
      if (!up.rows[0]) throw new Error(`No upload for ${county}`);
      uploadId = up.rows[0].id;
      console.log(`Upload: ${up.rows[0].filename} · ${up.rows[0].row_count} · ${uploadId}`);
    } else {
      const up = await client.query<{ filename: string; row_count: number }>(
        `SELECT filename, row_count FROM voter_uploads WHERE id = $1`,
        [uploadId],
      );
      console.log(`Upload: ${up.rows[0]?.filename} · ${up.rows[0]?.row_count} · ${uploadId}`);
    }

    // Optional fusion lean map (empty if arms never ran)
    const leanMap = new Map<string, string>();
    try {
      const leans = await client.query<{
        voter_record_id: string;
        lean: string | null;
      }>(
        `SELECT voter_record_id::text, lean
         FROM voter_lean_fusion
         WHERE upload_id = $1 AND lean IS NOT NULL AND lean <> 'Undetermined'`,
        [uploadId],
      );
      for (const r of leans.rows) leanMap.set(r.voter_record_id, r.lean!);
      console.log(`Fusion non-Undetermined leans available: ${leanMap.size}`);
    } catch {
      console.log('Fusion table not available or empty — tiers use party/history only');
    }

    // Stream in chunks to avoid loading 200k JSON at once
    const sides: CampaignSide[] = ['DEM', 'REP'];
    const counts: Record<CampaignSide, Record<PriorityTierId, number>> = {
      DEM: Object.fromEntries(PRIORITY_TIERS.map((t) => [t.id, 0])) as Record<
        PriorityTierId,
        number
      >,
      REP: Object.fromEntries(PRIORITY_TIERS.map((t) => [t.id, 0])) as Record<
        PriorityTierId,
        number
      >,
    };
    const contactableA: Record<CampaignSide, number> = { DEM: 0, REP: 0 };
    let n = 0;
    let offset = 0;
    const page = 5000;

    for (;;) {
      const { rows } = await client.query<{
        id: string;
        party: string;
        status: string;
        email: string | null;
        phone: string | null;
        history_summary: VoterHistorySummary | null;
      }>(
        `SELECT id::text,
                coalesce(raw_data->>'party','') AS party,
                coalesce(raw_data->>'status','') AS status,
                nullif(trim(raw_data->>'email'),'') AS email,
                nullif(trim(raw_data->>'phone'),'') AS phone,
                history_summary
         FROM voter_records
         WHERE upload_id = $1
         ORDER BY row_index
         OFFSET $2 LIMIT $3`,
        [uploadId, offset, page],
      );
      if (rows.length === 0) break;

      for (const row of rows) {
        n++;
        const hist = row.history_summary;
        const turnout = hist?.turnout_propensity ?? null;
        const settled = leanMap.get(row.id) as
          | 'Left'
          | 'Right'
          | 'Independent'
          | 'Undetermined'
          | undefined;
        const base = {
          party: row.party,
          status: row.status,
          turnoutPropensity: turnout as 'High' | 'Medium' | 'Low' | null,
          hasEmail: Boolean(row.email),
          hasPhone: Boolean(row.phone),
          hasHistory: Boolean(hist),
          settledLean: settled ?? null,
        };
        for (const side of sides) {
          const r = assignPriorityTier(base, side);
          counts[side][r.tier]++;
          if (r.tier === 'A_core_gotv' || r.tier === 'B_inactive_chase' || r.tier === 'C_npa_expand') {
            if (r.contactable) contactableA[side]++;
          }
        }
      }
      offset += rows.length;
      if (rows.length < page) break;
      process.stdout.write(`  scored ${n.toLocaleString()}…\r`);
    }

    console.log(`\nScored ${n.toLocaleString()} voters (each counted once per campaign side).\n`);

    for (const side of sides) {
      console.log(`======== Campaign side: ${side} ========`);
      console.log(
        `${'Tier'.padEnd(22)} ${'Count'.padStart(10)} ${'%'.padStart(7)}  Why`,
      );
      let sum = 0;
      for (const t of PRIORITY_TIERS) {
        const c = counts[side][t.id];
        sum += c;
        const pct = n ? ((100 * c) / n).toFixed(1) : '0';
        console.log(
          `${t.label.padEnd(22)} ${c.toLocaleString().padStart(10)} ${pct.padStart(6)}%  ${t.why}`,
        );
      }
      const chase =
        counts[side].A_core_gotv +
        counts[side].B_inactive_chase +
        counts[side].C_npa_expand;
      console.log(
        `\n  Actionable chase pool (A+B+C): ${chase.toLocaleString()} (${n ? ((100 * chase) / n).toFixed(1) : 0}% of universe)`,
      );
      console.log(
        `  Of which in A alone: ${counts[side].A_core_gotv.toLocaleString()} (same-party low/med turnout + contact)`,
      );
      console.log('');
    }

    // Sanity: cross-check party totals
    const partyCheck = await client.query(
      `SELECT raw_data->>'party' AS party, count(*)::int AS n
       FROM voter_records WHERE upload_id = $1
       GROUP BY 1 ORDER BY n DESC LIMIT 8`,
      [uploadId],
    );
    console.log('Party mix (raw):', partyCheck.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
