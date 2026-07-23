/**
 * Reverse lean-corpus experiment via Exa *news* (letters / endorsements),
 * then match author-ish names onto a GOTV upload.
 *
 * Usage:
 *   npx tsx scripts/probe-exa-news-lean.ts --upload 77c730ec-… --num 8
 *   npx tsx scripts/probe-exa-news-lean.ts --county CAL --num 8
 *
 * Read-only. Requires EXA_API_KEY + DATABASE_URL.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { getExaApiKey } from '@/lib/exa/config';
import { searchWeb } from '@/lib/exa/client';
import type { ExaSearchResult } from '@/lib/exa/types';
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

function norm(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type LeanGuess = 'Left' | 'Right' | 'Undetermined';

const RIGHT_RE =
  /\b(republican|gop|trump|maga|conservative|desantis|vote red)\b/i;
const LEFT_RE =
  /\b(democrat|democratic|biden|harris|progressive|vote blue|liberal)\b/i;

function inferLean(blob: string): { lean: LeanGuess; reasons: string[] } {
  const reasons: string[] = [];
  const r = RIGHT_RE.test(blob);
  const l = LEFT_RE.test(blob);
  if (r) reasons.push('right_keyword');
  if (l) reasons.push('left_keyword');
  if (r && !l) return { lean: 'Right', reasons };
  if (l && !r) return { lean: 'Left', reasons };
  if (r && l) return { lean: 'Undetermined', reasons: [...reasons, 'both'] };
  return { lean: 'Undetermined', reasons: ['no_party_keyword'] };
}

/** Pull plausible person names from title/highlights (letters often "Name: …"). */
function extractNameCandidates(r: ExaSearchResult): string[] {
  const texts = [r.title, r.author ?? '', ...(r.highlights ?? [])].join('\n');
  const found = new Set<string>();

  // "Letters: Jane Doe says…" / "Jane Doe: …"
  const patterns = [
    /letters?:\s*([A-Z][a-z]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z]+)+)/g,
    /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(?:of|from)\s+(?:Blountstown|Altha|Calhoun|Gainesville)/gi,
    /^([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s*[:—–-]/gm,
    /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+wrote\b/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    const copy = new RegExp(re.source, re.flags);
    while ((m = copy.exec(texts)) !== null) {
      const name = m[1].replace(/\s+/g, ' ').trim();
      if (name.split(/\s+/).length >= 2 && name.length < 40) found.add(name);
    }
  }
  if (r.author && /^[A-Z]/.test(r.author) && r.author.split(/\s+/).length >= 2) {
    found.add(r.author.trim());
  }
  return [...found].slice(0, 5);
}

function newsQueries(place: string): string[] {
  return [
    `letter to the editor ${place} Florida (Republican OR Democrat OR Trump OR Biden OR Harris)`,
    `${place} Florida endorsement (candidate OR commissioner OR school board) letter`,
    `${place} Florida opinion (conservative OR progressive OR MAGA) letter`,
  ];
}

async function main() {
  loadEnvLocal();
  if (!getExaApiKey()) throw new Error('EXA_API_KEY required');
  if (!process.env.DATABASE_URL || !process.env.ALLOWED_USER_EMAIL) {
    throw new Error('DATABASE_URL + ALLOWED_USER_EMAIL required');
  }

  const num = Math.min(12, Math.max(3, Number(arg('--num') ?? 8)));
  const place = arg('--place') ?? 'Blountstown OR Altha OR Calhoun County';
  const email = process.env.ALLOWED_USER_EMAIL;
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
      const county = (arg('--county') ?? 'CAL').toUpperCase();
      const up = await client.query<{ id: string; filename: string; row_count: number }>(
        `SELECT id, filename, row_count FROM voter_uploads
         WHERE user_id = $1 AND filename ILIKE $2 AND status = 'ready'
         ORDER BY created_at DESC LIMIT 1`,
        [email, `${county}%`],
      );
      if (!up.rows[0]) throw new Error(`No ready upload for ${county}`);
      uploadId = up.rows[0].id;
      console.log(
        `Using ${up.rows[0].filename} · ${up.rows[0].row_count} voters · ${uploadId}`,
      );
    }

    const queries = newsQueries(place);
    let totalCost = 0;
    const articles: {
      title: string;
      url: string;
      lean: LeanGuess;
      names: string[];
      snippet: string;
      query: string;
    }[] = [];

    for (const q of queries) {
      const res = await searchWeb(q, {
        category: 'news',
        numResults: num,
        highlights: true,
        type: 'auto',
      });
      if (res.costDollars.total != null) totalCost += res.costDollars.total;
      for (const r of res.results) {
        const blob = [r.title, ...(r.highlights ?? [])].join('\n');
        const { lean } = inferLean(blob);
        const names = extractNameCandidates(r);
        articles.push({
          title: r.title,
          url: r.url,
          lean,
          names,
          snippet: (r.highlights?.[0] ?? '').slice(0, 200),
          query: q,
        });
      }
    }

    // Dedupe by URL
    const byUrl = new Map(articles.map((a) => [a.url, a]));
    const unique = [...byUrl.values()];

    console.log(`\nNews harvest: ${unique.length} unique articles · cost $${totalCost.toFixed(4)}`);
    console.log(
      `  lean: L=${unique.filter((a) => a.lean === 'Left').length} R=${unique.filter((a) => a.lean === 'Right').length} U=${unique.filter((a) => a.lean === 'Undetermined').length}`,
    );

    type Match = {
      article: (typeof unique)[0];
      name: string;
      rowIndex: number;
      voterName: string;
      city: string;
      party: string;
      status: string;
    };
    const matches: Match[] = [];

    for (const a of unique) {
      for (const name of a.names) {
        const parts = norm(name).split(/\s+/);
        if (parts.length < 2) continue;
        const last = parts[parts.length - 1];
        const first = parts[0];
        const { rows } = await client.query<{
          row_index: number;
          raw_data: ParsedFlVoterRecord;
        }>(
          `SELECT row_index, raw_data FROM voter_records
           WHERE upload_id = $1 AND user_id = $2
             AND lower(raw_data->'name'->>'last') = $3
           LIMIT 20`,
          [uploadId, email, last],
        );
        for (const row of rows) {
          const rec = row.raw_data;
          const vf = norm(rec.name?.first ?? '');
          if (vf && vf !== first && !first.startsWith(vf) && !vf.startsWith(first)) continue;
          matches.push({
            article: a,
            name,
            rowIndex: row.row_index,
            voterName: rec.name?.full ?? '',
            city: rec.residence?.city ?? '',
            party: String(rec.party ?? ''),
            status: String(rec.status ?? ''),
          });
        }
      }
    }

    console.log(`\n--- Sample articles (12) ---`);
    for (const a of unique.slice(0, 12)) {
      console.log(`  [${a.lean}] ${a.title.slice(0, 90)}`);
      console.log(`     ${a.url.slice(0, 100)}`);
      console.log(`     names: ${a.names.join(', ') || '(none extracted)'}`);
    }

    console.log(`\n--- Name matches onto upload (${matches.length}) ---`);
    if (matches.length === 0) console.log('  (none)');
    const seen = new Set<string>();
    for (const m of matches) {
      const k = `${m.rowIndex}:${m.article.url}`;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(
        `  [${m.article.lean}] "${m.name}" → row ${m.rowIndex} ${m.voterName} (${m.city}) party=${m.party} status=${m.status}`,
      );
      console.log(`     via: ${m.article.title.slice(0, 80)}`);
    }

    console.log(`\nTotal Exa cost (reported): $${totalCost.toFixed(4)}`);
    console.log(
      'Note: letter author extraction is heuristic; matches need human review before any settle.',
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
