import { normalizeNameKey, zip5 } from '@/lib/reference-data/normalize';

export interface SunbizOfficerRecord {
  corp_number: string;
  corp_name: string;
  corp_status: string;
  filing_type: string;
  principal_city: string;
  principal_zip5: string;
  officer_title: string;
  officer_type: string;
  officer_name: string;
  officer_city: string;
  officer_zip5: string;
  officer_address: string;
}

function sliceField(line: string, start: number, length: number): string {
  return line.slice(start - 1, start - 1 + length).trim();
}

const OFFICER_BASE = 668;
const OFFICER_BLOCK_LEN = 128;
const MAX_OFFICERS = 6;

/**
 * Parse one 1440-char Sunbiz corporate data record; yields up to 6 officer rows.
 * @see https://dos.sunbiz.org/data-definitions/cor.html
 */
export function parseSunbizCorLine(line: string): SunbizOfficerRecord[] {
  if (line.length < 900) return [];

  const corp_number = sliceField(line, 1, 12);
  const corp_name = sliceField(line, 13, 192);
  if (!corp_number || !corp_name) return [];

  const corp_status = sliceField(line, 205, 1);
  const filing_type = sliceField(line, 206, 15);
  const principal_city = sliceField(line, 305, 28);
  const principal_zip5 = zip5(sliceField(line, 335, 10));

  const out: SunbizOfficerRecord[] = [];

  for (let i = 0; i < MAX_OFFICERS; i += 1) {
    const base = OFFICER_BASE + i * OFFICER_BLOCK_LEN;
    const officer_name = line.slice(base + 5, base + 47).trim();
    if (!officer_name) continue;

    out.push({
      corp_number,
      corp_name,
      corp_status,
      filing_type,
      principal_city,
      principal_zip5,
      officer_title: line.slice(base, base + 4).trim(),
      officer_type: line.slice(base + 4, base + 5).trim(),
      officer_name,
      officer_address: line.slice(base + 47, base + 89).trim(),
      officer_city: line.slice(base + 89, base + 117).trim(),
      officer_zip5: zip5(line.slice(base + 119, base + 128)),
    });
  }

  return out;
}

export function officerNameNorm(name: string): string {
  return normalizeNameKey(name);
}

export function corpNameNorm(name: string): string {
  return normalizeNameKey(name);
}