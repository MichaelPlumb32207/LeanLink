import { mkdir, writeFile, stat } from 'fs/promises';
import { join } from 'path';

const CONTRIB_PAGE =
  'https://dos.elections.myflorida.com/campaign-finance/contributions/';
const CONTRIB_POST = 'https://dos.elections.myflorida.com/cgi-bin/contrib.exe';

function formatMdy(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export interface FlContribDownloadRange {
  from: Date;
  thru: Date;
}

export function monthlyContribRanges(from: Date, thru: Date): FlContribDownloadRange[] {
  const ranges: FlContribDownloadRange[] = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(thru.getFullYear(), thru.getMonth(), thru.getDate());

  while (cursor <= end) {
    const monthEnd = endOfMonth(cursor);
    const thruDate = monthEnd > end ? end : monthEnd;
    ranges.push({ from: new Date(cursor), thru: thruDate });
    cursor = addMonths(cursor, 1);
    cursor.setDate(1);
  }
  return ranges;
}

function parseSetCookie(headers: string[]): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const h of headers) {
    const part = h.split(';')[0]?.trim();
    const eq = part?.indexOf('=');
    if (eq && eq > 0) {
      cookies[part.slice(0, eq)] = part.slice(eq + 1);
    }
  }
  return cookies;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export async function fetchFlContribSessionCookies(): Promise<Record<string, string>> {
  const res = await fetch(CONTRIB_PAGE, {
    headers: { 'User-Agent': 'LeanLink/1.0 (+https://four-plums.com; Michael@Four-Plums.com)' },
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  const cookies = parseSetCookie(raw);
  if (Object.keys(cookies).length === 0) {
    const single = res.headers.get('set-cookie');
    if (single) Object.assign(cookies, parseSetCookie([single]));
  }
  return cookies;
}

export async function downloadFlContribMonth(params: {
  range: FlContribDownloadRange;
  cookies: Record<string, string>;
  outDir: string;
  skipExisting?: boolean;
}): Promise<{ path: string; bytes: number; skipped: boolean }> {
  const fromYmd = formatYmd(params.range.from).replace(/-/g, '');
  const thruYmd = formatYmd(params.range.thru).replace(/-/g, '');
  const filename = `flc_${fromYmd}-${thruYmd}.tsv`;
  const path = join(params.outDir, filename);

  if (params.skipExisting !== false) {
    try {
      const st = await stat(path);
      if (st.size > 200) {
        return { path, bytes: st.size, skipped: true };
      }
    } catch {
      /* download */
    }
  }

  const body = new URLSearchParams({
    election: 'All',
    search_on: '1',
    CanFName: '',
    CanLName: '',
    CanNameSrch: '2',
    office: 'All',
    cdistrict: '',
    cgroup: '',
    party: 'All',
    ComName: '',
    ComNameSrch: '2',
    committee: 'All',
    cfname: '',
    clname: '',
    namesearch: '2',
    ccity: '',
    cstate: '',
    czipcode: '',
    cpurpose: '',
    cdollar_minimum: '',
    cdollar_maximum: '',
    rowlimit: '',
    csort1: 'DAT',
    csort2: 'CAN',
    cdatefrom: formatMdy(params.range.from),
    cdateto: formatMdy(params.range.thru),
    queryformat: '2',
    Submit: 'Submit',
  });

  const res = await fetch(CONTRIB_POST, {
    method: 'POST',
    headers: {
      'User-Agent': 'LeanLink/1.0 (+https://four-plums.com; Michael@Four-Plums.com)',
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(params.cookies),
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`FL contrib download failed ${res.status} for ${filename}`);
  }

  const text = await res.text();
  if (text.length < 50 || text.toLowerCase().includes('no records')) {
    await writeFile(path, '');
    return { path, bytes: 0, skipped: false };
  }

  await writeFile(path, text, 'utf8');
  return { path, bytes: text.length, skipped: false };
}

export async function downloadFlContribRange(params: {
  from: Date;
  thru: Date;
  outDir: string;
  delayMs?: number;
  onProgress?: (info: {
    index: number;
    total: number;
    file: string;
    bytes: number;
    skipped: boolean;
  }) => void;
}): Promise<{ files: string[]; total_bytes: number }> {
  await mkdir(params.outDir, { recursive: true });
  const cookies = await fetchFlContribSessionCookies();
  const ranges = monthlyContribRanges(params.from, params.thru);
  const files: string[] = [];
  let total_bytes = 0;

  for (let i = 0; i < ranges.length; i += 1) {
    const result = await downloadFlContribMonth({
      range: ranges[i],
      cookies,
      outDir: params.outDir,
    });
    if (result.bytes > 0) files.push(result.path);
    total_bytes += result.bytes;
    params.onProgress?.({
      index: i + 1,
      total: ranges.length,
      file: result.path,
      bytes: result.bytes,
      skipped: result.skipped,
    });
    if (params.delayMs && i < ranges.length - 1) {
      await new Promise((r) => setTimeout(r, params.delayMs));
    }
  }

  return { files, total_bytes };
}