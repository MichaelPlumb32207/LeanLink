/**
 * Bluesky coverage probe (ENH-017) — the cheap "is this even worth building?"
 * measurement before investing in a follow-graph scorer.
 *
 * The follow-graph is only a useful lean signal if our voters are ACTUALLY on
 * Bluesky and we can CONFIDENTLY link them. Bluesky is small and skewed, so the
 * open question is coverage. This resolves candidate accounts by name for a
 * cohort of eligible voters and reports, in tiers of confidence:
 *   - any candidate returned by name search (weak — common names over-match)
 *   - a display-name match (first + last both present)
 *   - a plausible FL link (name match AND a FL/city signal in bio, or the email
 *     username inside the handle) — the only tier we'd trust to attach a graph
 *
 * Free: Bluesky's public AppView, no auth, no Grok, no spend. Read-only DB.
 *
 * Usage:
 *   npx tsx scripts/bluesky-coverage-probe.ts --county DUV --limit 30
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { searchActors, getProfile, bskyDelay, type BskyActor } from '@/lib/bluesky/client';
import { CLAIM_ELIGIBLE_PREDICATE } from '@/lib/evidence/arm-runs';

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
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

interface CohortVoter {
  name_full: string;
  first: string;
  last: string;
  city: string;
  email_local: string | null;
}

async function main() {
  loadEnvLocal();
  const email = process.env.ALLOWED_USER_EMAIL;
  const url = process.env.DATABASE_URL;
  if (!email || !url) throw new Error('ALLOWED_USER_EMAIL and DATABASE_URL required');
  const county = arg('--county') ?? 'DUV';
  const limit = Math.max(1, Number(arg('--limit') ?? 30));

  // --- self-test: prove the client + AppView are reachable ---
  const known = await getProfile('bsky.app');
  if (!known) throw new Error('Bluesky self-test failed — could not resolve bsky.app (network/AppView down?)');
  console.log(`Bluesky reachable ✓ (bsky.app: ${known.followersCount?.toLocaleString()} followers)\n`);

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
  const c = await pool.connect();
  let cohort: CohortVoter[] = [];
  try {
    await c.query(`SELECT set_config('app.current_user', $1, true)`, [email]);
    const up = await c.query<{ id: string }>(
      `SELECT id FROM voter_uploads WHERE user_id = $1 AND filename ILIKE $2 ORDER BY created_at DESC LIMIT 1`,
      [email, `${county}_%`],
    );
    const uid = up.rows[0]?.id;
    if (!uid) throw new Error(`No ${county} upload found`);
    const rows = await c.query<{ name_full: string; first: string; last: string; city: string; email: string | null }>(
      `SELECT vr.raw_data->'name'->>'full' AS name_full,
              vr.raw_data->'name'->>'first' AS first,
              vr.raw_data->'name'->>'last' AS last,
              vr.raw_data->'residence'->>'city' AS city,
              vr.raw_data->>'email' AS email
       FROM voter_records vr
       WHERE vr.upload_id = $1 AND vr.user_id = $2 AND ${CLAIM_ELIGIBLE_PREDICATE}
       ORDER BY (vr.raw_data->>'email' IS NOT NULL AND vr.raw_data->>'email' <> '') DESC,
                (vr.history_summary IS NOT NULL) DESC, vr.row_index ASC
       LIMIT $3`,
      [uid, email, limit],
    );
    cohort = rows.rows.map((r) => ({
      name_full: r.name_full,
      first: r.first ?? '',
      last: r.last ?? '',
      city: r.city ?? '',
      email_local: r.email ? r.email.split('@')[0].toLowerCase() : null,
    }));
  } finally {
    c.release();
    await pool.end();
  }

  console.log(`Probing ${cohort.length} eligible ${county} voters against Bluesky…\n`);
  const stat = { any: 0, name_match: 0, fl_plausible: 0, email_handle: 0 };
  const hits: string[] = [];
  const nameMatchSample: string[] = [];

  for (const v of cohort) {
    // Search first+last only — Bluesky's typeahead over-constrains on a full
    // name with middle names (that was v1's bug: 0/30 across the board).
    const first = norm(v.first).split(' ')[0];
    const last = norm(v.last).split(' ').pop() ?? '';
    const query = `${first} ${last}`.trim() || v.name_full;
    let actors: BskyActor[] = [];
    try {
      actors = await searchActors(query, 25);
    } catch {
      await bskyDelay(400);
      continue;
    }
    if (actors.length) stat.any += 1;

    const nameMatch = actors.find((a) => {
      const dn = norm(a.displayName ?? '');
      return first && last && dn.includes(first) && dn.includes(last);
    });
    if (nameMatch) {
      stat.name_match += 1;
      const bio = (nameMatch.description ?? '').replace(/\s+/g, ' ').slice(0, 70);
      nameMatchSample.push(`  voter "${v.name_full}" (${v.city}) ~ @${nameMatch.handle}${nameMatch.displayName ? ` "${nameMatch.displayName}"` : ''}${bio ? ` — ${bio}` : ' — (no bio)'}`);
    }

    const emailHandle = v.email_local
      ? actors.find((a) => a.handle.toLowerCase().includes(v.email_local!))
      : undefined;
    if (emailHandle) stat.email_handle += 1;

    const flSignal = (a: BskyActor | undefined) => {
      if (!a) return false;
      const blob = norm(`${a.description ?? ''} ${a.handle}`);
      return blob.includes('florida') || blob.includes(' fl ') || (v.city && blob.includes(norm(v.city)));
    };
    const plausible = (nameMatch && flSignal(nameMatch)) || emailHandle;
    if (plausible) {
      stat.fl_plausible += 1;
      const a = (emailHandle ?? nameMatch)!;
      hits.push(`  ${v.name_full} (${v.city}) → @${a.handle}${a.displayName ? ` "${a.displayName}"` : ''}`);
    }
    await bskyDelay(150);
  }

  const pct = (n: number) => `${((n / cohort.length) * 100).toFixed(0)}%`;
  console.log('=========== Bluesky coverage ===========');
  console.log(`Cohort:                  ${cohort.length}`);
  console.log(`Any name-search hit:     ${stat.any} (${pct(stat.any)})  ← weak; common names over-match`);
  console.log(`Display-name match:      ${stat.name_match} (${pct(stat.name_match)})`);
  console.log(`Email-username in handle:${stat.email_handle} (${pct(stat.email_handle)})  ← strong link`);
  console.log(`FL-plausible link:       ${stat.fl_plausible} (${pct(stat.fl_plausible)})  ← the only tier we'd trust`);
  if (hits.length) {
    console.log('\nPlausible matches:');
    hits.forEach((h) => console.log(h));
  }
  if (nameMatchSample.length) {
    console.log('\nName-matches (are these our voters? eyeball the bios):');
    nameMatchSample.forEach((h) => console.log(h));
  }
  console.log('\nRead: if FL-plausible ≈ 0, our voters are not linkably on Bluesky —');
  console.log('the follow-graph scorer would have nothing to score. Coverage, not code, is the gate.');
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
