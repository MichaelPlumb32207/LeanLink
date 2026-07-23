/**
 * Tiny reverse-corpus experiment: Exa People for *lean-bearing* public profiles
 * (party roles / activism), then match names onto an NPA upload in Neon.
 *
 * Budget-conscious: fixed query list × small numResults. Read-only (no evidence writes).
 *
 * Usage:
 *   npx tsx scripts/probe-exa-lean-corpus.ts --county CAL
 *   npx tsx scripts/probe-exa-lean-corpus.ts --county ALA
 *   npx tsx scripts/probe-exa-lean-corpus.ts --county CAL,ALA
 *   npx tsx scripts/probe-exa-lean-corpus.ts --county CAL --num 8 --json
 *
 * Requires EXA_API_KEY, DATABASE_URL, ALLOWED_USER_EMAIL.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { getExaApiKey } from '@/lib/exa/config';
import { searchPeople } from '@/lib/exa/client';
import type { ExaSearchResult } from '@/lib/exa/types';
import { flCountyLabel } from '@/lib/fl-counties';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

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

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function norm(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type LeanGuess = 'Left' | 'Right' | 'Undetermined';

interface HarvestHit {
  url: string;
  name: string;
  location: string | null;
  lean: LeanGuess;
  leanReasons: string[];
  signalSnippets: string[];
  workTitles: string[];
  companyNames: string[];
  query: string;
}

interface VoterMatch {
  rowIndex: number;
  voterName: string;
  city: string;
  matchKind: 'name_city' | 'name_county' | 'name_only';
}

/** Fixed reverse queries — lean-first, not identity-first. */
function leanCorpusQueries(countyCode: string): string[] {
  const county = flCountyLabel(countyCode);
  const code = countyCode.toUpperCase();

  if (code === 'CAL') {
    return [
      `Republican Executive Committee OR Republican Party chair OR precinct committeeman Calhoun County Florida OR Blountstown`,
      `Democratic Party chair OR Democratic Executive Committee OR precinct committee Calhoun County Florida OR Blountstown`,
      `conservative activist OR Trump supporter OR Republican club Blountstown OR Altha OR Calhoun County Florida`,
      `progressive activist OR Democrat organizer OR volunteer Calhoun County Florida OR Blountstown`,
    ];
  }

  if (code === 'ALA') {
    return [
      `Republican Executive Committee OR Republican Party chair OR precinct committeeman Alachua County Florida OR Gainesville`,
      `Democratic Party chair OR Democratic Executive Committee OR precinct committee Alachua County Florida OR Gainesville`,
      `College Republicans OR Young Republicans University of Florida Gainesville`,
      `College Democrats OR Young Democrats University of Florida Gainesville`,
      `progressive activist OR Florida Rising OR labor organizer Gainesville Florida`,
      `conservative activist OR Trump OR Republican club Gainesville OR Alachua County Florida`,
    ];
  }

  // Generic fallback
  return [
    `Republican Party chair OR Republican Executive Committee ${county} County Florida`,
    `Democratic Party chair OR Democratic Executive Committee ${county} County Florida`,
    `political activist ${county} County Florida`,
  ];
}

const RIGHT_RE =
  /\b(republican|gop|trump|maga|conservative|rpof|young republicans|college republicans|tea party)\b/i;
const LEFT_RE =
  /\b(democrat|democratic party|progressive|afl-?cio|florida rising|college democrats|young democrats|labor organizer|bernie|actblue)\b/i;

function inferLeanFromText(blob: string): { lean: LeanGuess; reasons: string[] } {
  const reasons: string[] = [];
  const right = RIGHT_RE.test(blob);
  const left = LEFT_RE.test(blob);
  if (right) reasons.push('right_keyword');
  if (left) reasons.push('left_keyword');
  if (right && !left) return { lean: 'Right', reasons };
  if (left && !right) return { lean: 'Left', reasons };
  if (right && left) return { lean: 'Undetermined', reasons: [...reasons, 'both_sides'] };
  return { lean: 'Undetermined', reasons: ['no_party_keyword'] };
}

function displayName(r: ExaSearchResult): string {
  if (r.person?.name) return r.person.name;
  if (r.person?.firstName || r.person?.lastName) {
    return [r.person.firstName, r.person.lastName].filter(Boolean).join(' ');
  }
  return (r.title.split(/[-|–—]/)[0] ?? r.title).trim();
}

function harvestFromResult(r: ExaSearchResult, query: string): HarvestHit | null {
  const name = displayName(r);
  if (!name || name.length < 3) return null;

  const workTitles = (r.person?.workHistory ?? [])
    .map((w) => w.title)
    .filter((x): x is string => Boolean(x));
  const companyNames = (r.person?.workHistory ?? [])
    .map((w) => w.companyName)
    .filter((x): x is string => Boolean(x));
  const location = r.person?.location ?? null;
  const snippets = [
    ...r.highlights.slice(0, 6),
    r.summary ?? '',
    r.title,
    ...workTitles,
    ...companyNames,
  ].filter(Boolean);

  const blob = snippets.join('\n');
  const { lean, reasons } = inferLeanFromText(blob);

  // Keep Undetermined only if there is *some* political-ish language; drop pure career noise
  const politicalish =
    lean !== 'Undetermined' ||
    /\b(party|committee|precinct|activist|campaign|election|political|chair)\b/i.test(blob);
  if (!politicalish) return null;

  return {
    url: r.url,
    name,
    location,
    lean,
    leanReasons: reasons,
    signalSnippets: snippets.map((s) => s.slice(0, 240)).slice(0, 4),
    workTitles: workTitles.slice(0, 5),
    companyNames: companyNames.slice(0, 5),
    query,
  };
}

function parseNameParts(full: string): { first: string; last: string; tokens: string[] } {
  const tokens = norm(full).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: '', last: '', tokens };
  if (tokens.length === 1) return { first: tokens[0], last: tokens[0], tokens };
  return { first: tokens[0], last: tokens[tokens.length - 1], tokens };
}

function cityMatchesCounty(city: string, countyCode: string): boolean {
  const c = norm(city);
  if (!c) return false;
  if (countyCode === 'CAL') {
    return (
      c.includes('blountstown') ||
      c.includes('altha') ||
      c.includes('clarksville') ||
      c.includes('fountain') ||
      c.includes('kinard') ||
      c.includes('calhoun')
    );
  }
  if (countyCode === 'ALA') {
    return (
      c.includes('gainesville') ||
      c.includes('newberry') ||
      c.includes('alachua') ||
      c.includes('high springs') ||
      c.includes('archer') ||
      c.includes('hawthorne') ||
      c.includes('micanopy') ||
      c.includes('waldo')
    );
  }
  return c.includes(norm(flCountyLabel(countyCode)));
}

function locationInCounty(location: string | null, countyCode: string): boolean {
  if (!location) return false;
  const loc = norm(location);
  if (!loc.includes('florida') && !loc.includes(' fl')) {
    // still allow city-only strings
  }
  if (countyCode === 'CAL') {
    return (
      loc.includes('blountstown') ||
      loc.includes('altha') ||
      loc.includes('calhoun') ||
      loc.includes('clarksville')
    );
  }
  if (countyCode === 'ALA') {
    return (
      loc.includes('gainesville') ||
      loc.includes('alachua') ||
      loc.includes('newberry') ||
      loc.includes('high springs') ||
      loc.includes('florida') // UF people often "Gainesville, Florida"
    );
  }
  return loc.includes(norm(flCountyLabel(countyCode))) || loc.includes('florida');
}

async function matchToUpload(
  client: import('pg').PoolClient,
  uploadId: string,
  userId: string,
  hit: HarvestHit,
  countyCode: string,
): Promise<VoterMatch[]> {
  const { first, last } = parseNameParts(hit.name);
  if (!last || last.length < 2) return [];

  // Pull candidates with same last name (bounded)
  const { rows } = await client.query<{
    row_index: number;
    raw_data: ParsedFlVoterRecord;
  }>(
    `SELECT row_index, raw_data
     FROM voter_records
     WHERE upload_id = $1 AND user_id = $2
       AND lower(raw_data->'name'->>'last') = $3
     LIMIT 40`,
    [uploadId, userId, last],
  );

  const matches: VoterMatch[] = [];
  for (const row of rows) {
    const rec = row.raw_data;
    const vFirst = norm(rec.name?.first ?? '');
    const vFull = norm(rec.name?.full ?? '');
    const vCity = rec.residence?.city ?? '';

    // First name: exact or initial
    const firstOk =
      !first ||
      vFirst === first ||
      (first.length === 1 && vFirst.startsWith(first)) ||
      (vFirst.length >= 1 && first.startsWith(vFirst) && vFirst.length >= 3) ||
      vFull.startsWith(first);

    if (!firstOk) continue;

    let matchKind: VoterMatch['matchKind'] = 'name_only';
    if (vCity && cityMatchesCounty(vCity, countyCode)) {
      // Prefer city overlap with hit location when present
      const hitLoc = norm(hit.location ?? '');
      if (hitLoc && hitLoc.includes(norm(vCity))) {
        matchKind = 'name_city';
      } else if (locationInCounty(hit.location, countyCode) || cityMatchesCounty(vCity, countyCode)) {
        matchKind = hit.location ? 'name_county' : 'name_city';
      } else {
        matchKind = 'name_only';
      }
    } else if (locationInCounty(hit.location, countyCode)) {
      matchKind = 'name_county';
    }

    // Drop pure name_only unless last is rare (single last-name hit in sample)
    if (matchKind === 'name_only' && rows.length > 3) continue;

    matches.push({
      rowIndex: row.row_index,
      voterName: rec.name?.full ?? `${rec.name?.first} ${rec.name?.last}`,
      city: vCity,
      matchKind,
    });
  }

  // Prefer name_city > name_county > name_only
  const rank = { name_city: 0, name_county: 1, name_only: 2 };
  matches.sort((a, b) => rank[a.matchKind] - rank[b.matchKind]);
  return matches.slice(0, 5);
}

async function runCounty(
  pool: Pool,
  countyCode: string,
  numResults: number,
): Promise<{
  county: string;
  uploadId: string;
  filename: string;
  voterCount: number;
  queries: string[];
  harvest: HarvestHit[];
  totalCostUsd: number;
  matches: {
    hit: HarvestHit;
    voters: VoterMatch[];
  }[];
}> {
  const email = process.env.ALLOWED_USER_EMAIL!;
  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [email]);
    const uploadOverride = arg('--upload');
    const up = uploadOverride
      ? await client.query<{ id: string; filename: string; row_count: number }>(
          `SELECT id, filename, row_count FROM voter_uploads
           WHERE user_id = $1 AND id = $2 LIMIT 1`,
          [email, uploadOverride],
        )
      : await client.query<{ id: string; filename: string; row_count: number }>(
          `SELECT id, filename, row_count FROM voter_uploads
           WHERE user_id = $1 AND filename ILIKE $2 AND status = 'ready'
           ORDER BY created_at DESC LIMIT 1`,
          [email, `${countyCode}_%`],
        );
    if (!up.rows[0]) throw new Error(`No upload for ${countyCode}`);
    const uploadId = up.rows[0].id;
    const count = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM voter_records WHERE upload_id = $1`,
      [uploadId],
    );

    const queries = leanCorpusQueries(countyCode);
    const byUrl = new Map<string, HarvestHit>();
    let totalCost = 0;

    for (const q of queries) {
      const res = await searchPeople(q, {
        numResults,
        highlights: true,
        type: 'auto',
      });
      if (res.costDollars.total != null) totalCost += res.costDollars.total;
      for (const r of res.results) {
        const hit = harvestFromResult(r, q);
        if (!hit) continue;
        // Prefer FL / county-local when location known; still keep if lean is clear
        const existing = byUrl.get(hit.url);
        if (!existing || (existing.lean === 'Undetermined' && hit.lean !== 'Undetermined')) {
          byUrl.set(hit.url, hit);
        }
      }
    }

    const harvest = [...byUrl.values()];
    const matches: { hit: HarvestHit; voters: VoterMatch[] }[] = [];
    for (const hit of harvest) {
      if (hit.lean === 'Undetermined') {
        // Still try match but flag
      }
      const voters = await matchToUpload(client, uploadId, email, hit, countyCode);
      if (voters.length > 0) {
        matches.push({ hit, voters });
      }
    }

    return {
      county: countyCode,
      uploadId,
      filename: up.rows[0].filename,
      voterCount: count.rows[0].n,
      queries,
      harvest,
      totalCostUsd: totalCost,
      matches,
    };
  } finally {
    client.release();
  }
}

function printReport(
  r: Awaited<ReturnType<typeof runCounty>>,
) {
  console.log(`\n======== ${r.county} · ${r.filename} · ${r.voterCount} voters ========`);
  console.log(`Queries: ${r.queries.length} × up to N people`);
  console.log(`Unique harvest hits: ${r.harvest.length}`);
  const byLean = { Left: 0, Right: 0, Undetermined: 0 };
  for (const h of r.harvest) byLean[h.lean]++;
  console.log(
    `  lean among harvest: Left=${byLean.Left} Right=${byLean.Right} Undetermined=${byLean.Undetermined}`,
  );
  console.log(`NPA matches (any strength): ${r.matches.length} harvested people`);
  const strong = r.matches.filter((m) =>
    m.voters.some((v) => v.matchKind === 'name_city' || v.matchKind === 'name_county'),
  );
  console.log(`  with geo-corroborated voter link: ${strong.length}`);
  console.log(`Exa cost (reported): $${r.totalCostUsd.toFixed(4)}`);

  console.log(`\n--- Harvest sample (up to 12) ---`);
  for (const h of r.harvest.slice(0, 12)) {
    console.log(`  [${h.lean}] ${h.name} · ${h.location ?? '—'}`);
    console.log(`     ${h.url}`);
    if (h.workTitles[0]) console.log(`     work: ${h.workTitles[0]}${h.companyNames[0] ? ' @ ' + h.companyNames[0] : ''}`);
    if (h.signalSnippets[0]) console.log(`     signal: ${h.signalSnippets[0].replace(/\s+/g, ' ').slice(0, 160)}`);
  }

  console.log(`\n--- Matches to NPA list ---`);
  if (r.matches.length === 0) {
    console.log('  (none)');
  }
  for (const m of r.matches) {
    console.log(`  [${m.hit.lean}] ${m.hit.name}`);
    for (const v of m.voters) {
      console.log(`     → row ${v.rowIndex} ${v.voterName} (${v.city}) [${v.matchKind}]`);
    }
  }
}

async function main() {
  loadEnvLocal();
  if (!getExaApiKey()) throw new Error('EXA_API_KEY required');
  if (!process.env.DATABASE_URL || !process.env.ALLOWED_USER_EMAIL) {
    throw new Error('DATABASE_URL and ALLOWED_USER_EMAIL required');
  }

  const counties = (arg('--county') ?? 'CAL')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const numResults = Math.min(15, Math.max(3, Number(arg('--num') ?? 8)));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
    max: 2,
  });

  const reports = [];
  try {
    for (const c of counties) {
      console.log(`\nHarvesting lean corpus for ${c} (numResults=${numResults})…`);
      const r = await runCounty(pool, c, numResults);
      reports.push(r);
      if (!hasFlag('--json')) printReport(r);
    }
  } finally {
    await pool.end();
  }

  if (hasFlag('--json')) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    const totalCost = reports.reduce((s, r) => s + r.totalCostUsd, 0);
    const totalMatches = reports.reduce((s, r) => s + r.matches.length, 0);
    const totalHarvest = reports.reduce((s, r) => s + r.harvest.length, 0);
    console.log(`\n======== TOTAL ========`);
    console.log(`Counties: ${counties.join(', ')}`);
    console.log(`Harvest hits: ${totalHarvest}`);
    console.log(`People with ≥1 NPA match: ${totalMatches}`);
    console.log(`Exa cost (reported): $${totalCost.toFixed(4)}`);
    console.log(
      `Note: lean is keyword-inferred from profile text for this experiment — not fusion/settlement.`,
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
