import { normalizeNameKey, parseCityStateZip } from '@/lib/reference-data/normalize';
import type { FlContributionRow } from '@/lib/fl-contrib/types';

function parseAmount(value: string): number | null {
  const n = Number(value.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseDateMdy(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, '0');
  const dd = m[2].padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
}

/**
 * Parse a tab-delimited row from FL DOS contrib export.
 * Header: Candidate/Committee, Date, Amount, Typ, Contributor, Address, City State Zip, Occupation, ...
 */
export function parseFlContribTsvLine(line: string, isHeader = false): FlContributionRow | null {
  if (isHeader || !line.trim()) return null;
  const cols = line.split('\t');
  if (cols.length < 7) return null;

  const contributor_name = cols[4]?.trim();
  if (!contributor_name || contributor_name.toLowerCase() === 'contributor') return null;

  const geo = parseCityStateZip(cols[6]?.trim() ?? '');

  return {
    contributor_name,
    address: cols[5]?.trim() || null,
    city: geo.city || null,
    state: geo.state || 'FL',
    zip5: geo.zip5 || null,
    amount: parseAmount(cols[2] ?? ''),
    contribution_date: parseDateMdy(cols[1] ?? ''),
    committee_name: cols[0]?.trim() || null,
    contribution_type: cols[3]?.trim() || null,
    occupation: cols[7]?.trim() || null,
  };
}

export function contributorNameNorm(name: string): string {
  return normalizeNameKey(name);
}