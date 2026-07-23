/**
 * Read-only Exa People probe (Phase 1 spike).
 *
 * Loads a voter from Neon by county/upload + row_index, or accepts synthetic
 * --name/--city. Runs people lookup queries, scores candidates, prints summary.
 * **Writes nothing** to lean_results / evidence.
 *
 * Usage:
 *   npx tsx scripts/probe-exa-people.ts --county ALA --row 114
 *   npx tsx scripts/probe-exa-people.ts --upload <uuid> --row 0
 *   npx tsx scripts/probe-exa-people.ts --name "Marie Nancy Seraphin" --city Gainesville --county-label "Alachua County"
 *
 * Requires EXA_API_KEY (+ DATABASE_URL / ALLOWED_USER_EMAIL for DB load paths).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { getExaApiKey } from '@/lib/exa/config';
import { searchPeople } from '@/lib/exa/client';
import { buildPeopleLookupQueries } from '@/lib/exa/people-queries';
import { scorePeopleResults } from '@/lib/exa/score-people';
import type { ExaPeopleAnchor, ExaSearchResult } from '@/lib/exa/types';
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

function anchorFromRecord(
  record: ParsedFlVoterRecord,
  countyCode?: string,
): ExaPeopleAnchor {
  return {
    firstName: record.name.first,
    middleName: record.name.middle,
    lastName: record.name.last,
    fullName: record.name.full,
    city: record.residence.city,
    countyLabel: flCountyLabel(countyCode ?? record.countyCode),
    state:
      record.residence.state === 'FL' || !record.residence.state
        ? 'Florida'
        : record.residence.state,
    employerHint: record.employer ?? null,
  };
}

async function loadAnchorFromDb(): Promise<ExaPeopleAnchor | null> {
  const email = process.env.ALLOWED_USER_EMAIL;
  const url = process.env.DATABASE_URL;
  if (!email || !url) return null;

  const uploadArg = arg('--upload');
  const county = arg('--county');
  const row = arg('--row');
  if (row === undefined) return null;
  if (!uploadArg && !county) return null;

  const rowIndex = Number(row);
  if (!Number.isFinite(rowIndex) || rowIndex < 0) {
    throw new Error(`--row must be a non-negative integer, got ${row}`);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: true },
    max: 2,
  });
  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [email]);

    let uploadId = uploadArg;
    if (!uploadId && county) {
      const up = await client.query<{ id: string }>(
        `SELECT id FROM voter_uploads
         WHERE user_id = $1 AND filename ILIKE $2
         ORDER BY created_at DESC LIMIT 1`,
        [email, `${county}_%`],
      );
      uploadId = up.rows[0]?.id;
      if (!uploadId) throw new Error(`No upload found for county ${county}`);
    }

    const rec = await client.query<{
      raw_data: ParsedFlVoterRecord;
      filename: string | null;
    }>(
      `SELECT vr.raw_data, u.filename
       FROM voter_records vr
       JOIN voter_uploads u ON u.id = vr.upload_id
       WHERE vr.upload_id = $1 AND vr.user_id = $2 AND vr.row_index = $3
       LIMIT 1`,
      [uploadId, email, rowIndex],
    );
    if (!rec.rows[0]) {
      throw new Error(`No voter_records row for upload=${uploadId} row_index=${rowIndex}`);
    }
    const raw = rec.rows[0].raw_data;
    // County lives on the record (or filename prefix like DUV_/CAL_), not voter_uploads.
    const fromFile = (rec.rows[0].filename ?? '').match(/^([A-Z]{3})_/i)?.[1];
    return anchorFromRecord(raw, raw.countyCode || fromFile);
  } finally {
    client.release();
    await pool.end();
  }
}

function loadAnchorFromArgs(): ExaPeopleAnchor | null {
  const name = arg('--name');
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  const firstName = parts[0] ?? '';
  const lastName = parts[parts.length - 1] ?? '';
  const middleName = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
  return {
    firstName,
    middleName,
    lastName,
    fullName: name.trim(),
    city: arg('--city') ?? '',
    countyLabel: arg('--county-label'),
    state: arg('--state') ?? 'Florida',
    employerHint: arg('--employer') ?? null,
  };
}

async function main() {
  loadEnvLocal();
  if (!getExaApiKey()) {
    throw new Error(
      'EXA_API_KEY not set. Add it to .env.local (https://dashboard.exa.ai/api-keys).',
    );
  }

  const anchor = loadAnchorFromArgs() ?? (await loadAnchorFromDb());
  if (!anchor || !anchor.lastName) {
    console.error(`Usage:
  npx tsx scripts/probe-exa-people.ts --name "First Last" --city City [--county-label "X County"]
  npx tsx scripts/probe-exa-people.ts --county ALA --row 114
  npx tsx scripts/probe-exa-people.ts --upload <uuid> --row 0
Flags: --num 5  --json`);
    process.exit(1);
  }

  const queries = buildPeopleLookupQueries(anchor);
  const numResults = Number(arg('--num') ?? 5);
  const collected: ExaSearchResult[] = [];
  const batches: {
    query: string;
    durationMs: number;
    costUsd: number | null;
    rawTop: { title: string; url: string; name: string | null; location: string | null }[];
  }[] = [];
  let totalCost = 0;

  for (const q of queries) {
    const res = await searchPeople(q, { numResults });
    if (res.costDollars.total != null) totalCost += res.costDollars.total;
    collected.push(...res.results);
    batches.push({
      query: q,
      durationMs: res.durationMs,
      costUsd: res.costDollars.total,
      rawTop: res.results.map((r) => ({
        title: r.title,
        url: r.url,
        name: r.person?.name ?? null,
        location: r.person?.location ?? null,
      })),
    });
  }

  const candidates = scorePeopleResults(anchor, collected);
  const out = {
    anchor: {
      fullName: anchor.fullName,
      city: anchor.city,
      countyLabel: anchor.countyLabel ?? null,
      state: anchor.state ?? 'Florida',
    },
    queries,
    batches,
    candidates: candidates.map((c) => ({
      name: c.name,
      url: c.url,
      location: c.location,
      matchScore: Number(c.matchScore.toFixed(3)),
      matchReasons: c.matchReasons,
      workTitles: c.workTitles.slice(0, 3),
      companyNames: c.companyNames.slice(0, 3),
    })),
    totalCostUsd: totalCost || null,
    note: 'Read-only probe. Candidates never set lean. Job title is identity context only.',
  };

  if (hasFlag('--json')) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`Anchor: ${out.anchor.fullName} · ${out.anchor.city}, ${out.anchor.state}`);
  console.log(`Queries (${queries.length}):`);
  for (const q of queries) console.log(`  • ${q}`);
  console.log(`\nCandidates (${candidates.length}):`);
  if (candidates.length === 0) {
    console.log('  (none passed name+location gate)');
  }
  for (const [i, c] of out.candidates.entries()) {
    console.log(
      `  ${i + 1}. ${c.name}  score=${c.matchScore}  ${c.location ?? '—'}`,
    );
    console.log(`     ${c.url}`);
    console.log(`     reasons: ${c.matchReasons.join(', ')}`);
  }
  if (out.totalCostUsd != null) {
    console.log(`\nExa cost (reported): $${out.totalCostUsd.toFixed(4)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
