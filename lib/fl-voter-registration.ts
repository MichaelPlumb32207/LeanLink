/**
 * Florida Division of Elections — Voter Registration Extract
 * Tab-delimited, no header row. 38 fields (0–37).
 * Spec: final-voter-extract-disk-file-layout (May 2026)
 */

/** 0-based column indexes (FL DOS extract field number − 1) */
export const FL_VOTER_FIELD = {
  countyCode: 0,
  voterId: 1,
  nameLast: 2,
  nameSuffix: 3,
  nameFirst: 4,
  nameMiddle: 5,
  publicRecordsExemption: 6,
  residenceLine1: 7,
  residenceLine2: 8,
  residenceCity: 9,
  residenceState: 10,
  residenceZip: 11,
  mailingLine1: 12,
  mailingLine2: 13,
  mailingLine3: 14,
  mailingCity: 15,
  mailingState: 16,
  mailingZip: 17,
  mailingCountry: 18,
  gender: 19,
  race: 20,
  birthDate: 21,
  registrationDate: 22,
  partyAffiliation: 23,
  precinct: 24,
  precinctGroup: 25,
  precinctSplit: 26,
  precinctSuffix: 27,
  voterStatus: 28,
  congressionalDistrict: 29,
  houseDistrict: 30,
  senateDistrict: 31,
  countyCommissionDistrict: 32,
  schoolBoardDistrict: 33,
  daytimeAreaCode: 34,
  daytimePhoneNumber: 35,
  daytimePhoneExtension: 36,
  email: 37,
} as const;

// File uses 0-based indexes; email is last column at index 37.
export const FL_VOTER_FIELD_COUNT = 38;

export type FlVoterStatus = 'ACT' | 'INA';
export type FlPartyAffiliation = 'NPA' | 'DEM' | 'REP' | 'IND' | string;

export interface ParsedFlVoterRecord {
  countyCode: string;
  voterId: string;
  name: {
    last: string;
    suffix: string;
    first: string;
    middle: string;
    full: string;
  };
  residence: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
    full: string;
  };
  mailing: {
    line1: string;
    line2: string;
    line3: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  party: FlPartyAffiliation;
  status: FlVoterStatus | string;
  precinct: string;
  birthDate: string;
  registrationDate: string;
  phone: string | null;
  email: string | null;
  publicRecordsExemption: boolean;
  suppressed: boolean;
  raw: string[];
}

function field(row: string[], index: number): string {
  return (row[index] ?? '').trim();
}

function buildFullName(row: string[]): { last: string; suffix: string; first: string; middle: string; full: string } {
  const last = field(row, 2);
  const suffix = field(row, 3);
  const first = field(row, 4);
  const middle = field(row, 5);
  const full = [first, middle, last, suffix].filter(Boolean).join(' ');
  return { last, suffix, first, middle, full };
}

function buildResidence(row: string[]) {
  const line1 = field(row, 7);
  const line2 = field(row, 8);
  const city = field(row, 9);
  const state = field(row, 10);
  const zip = field(row, 11);
  const full = [line1, line2, city, state, zip].filter(Boolean).join(', ');
  return { line1, line2, city, state, zip, full };
}

function normalizeLine(line: string): string {
  // Do not use trim() — it strips trailing tab fields (empty columns at end of row).
  return line.replace(/\r$/, '').replace(/\n$/, '');
}

export function parseFlVoterLine(line: string): ParsedFlVoterRecord | null {
  const normalized = normalizeLine(line);
  if (!normalized) return null;

  const row = normalized.split('\t');
  if (row.length !== FL_VOTER_FIELD_COUNT) {
    throw new Error(`Expected ${FL_VOTER_FIELD_COUNT} tab fields, got ${row.length}`);
  }

  const area = field(row, 34);
  const phone = field(row, 35);
  const ext = field(row, 36);
  const email = field(row, 37);

  const suppressed = field(row, 2) === '*' || field(row, 4) === '*';

  return {
    countyCode: field(row, 0),
    voterId: field(row, 1),
    name: buildFullName(row),
    residence: buildResidence(row),
    mailing: {
      line1: field(row, 12),
      line2: field(row, 13),
      line3: field(row, 14),
      city: field(row, 15),
      state: field(row, 16),
      zip: field(row, 17),
      country: field(row, 18),
    },
    party: field(row, 23),
    status: field(row, 28),
    precinct: field(row, 24),
    birthDate: field(row, 21),
    registrationDate: field(row, 22),
    phone: area && phone ? `${area}-${phone}${ext ? ` x${ext}` : ''}` : null,
    email: email || null,
    publicRecordsExemption: field(row, 6) === 'Y',
    suppressed,
    raw: row,
  };
}

export interface FlIngestFilter {
  party?: FlPartyAffiliation;
  status?: FlVoterStatus;
  excludeExempt?: boolean;
  excludeSuppressed?: boolean;
}

export const DEFAULT_LEANLINK_FILTER: FlIngestFilter = {
  party: 'NPA',
  status: 'ACT',
  excludeExempt: true,
  excludeSuppressed: true,
};

export function passesLeanLinkFilter(
  record: ParsedFlVoterRecord,
  filter: FlIngestFilter = DEFAULT_LEANLINK_FILTER,
): boolean {
  if (filter.party && record.party !== filter.party) return false;
  if (filter.status && record.status !== filter.status) return false;
  if (filter.excludeExempt && record.publicRecordsExemption) return false;
  if (filter.excludeSuppressed && record.suppressed) return false;
  return true;
}

export function parseFlVoterFile(content: string, filter?: FlIngestFilter): ParsedFlVoterRecord[] {
  const lines = content.split(/\r?\n/);
  const results: ParsedFlVoterRecord[] = [];

  for (const line of lines) {
    const record = parseFlVoterLine(line);
    if (!record) continue;
    if (filter && !passesLeanLinkFilter(record, filter)) continue;
    results.push(record);
  }

  return results;
}