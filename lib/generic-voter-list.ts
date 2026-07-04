/**
 * Generic client intake — accept an arbitrary voter list (CSV / TSV / pasted /
 * JSON) and normalize each row into a `ParsedFlVoterRecord` so every existing
 * enrichment arm consumes it unchanged.
 *
 * Unlike the FL DOS extract there is NO voter ID and NO fixed column order — we
 * map flexible header names and gate on a minimum identity anchor:
 *   required = name (first+last, or full) + state (default FL) + >=1 of
 *   county / ZIP / street address.
 * Everything past the floor is optional and feeds the data-completeness score.
 */
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import { scoreCompleteness, type CompletenessResult } from '@/lib/intake/completeness';

/** Canonical intake fields, after header aliasing. */
export interface GenericVoterInput {
  fullName?: string;
  first?: string;
  middle?: string;
  last?: string;
  suffix?: string;
  county?: string;
  address?: string; // street line
  city?: string;
  state?: string;
  zip?: string;
  dob?: string;
  email?: string;
  phone?: string;
  employer?: string;
  occupation?: string;
  party?: string;
  voterId?: string;
}

export interface GenericParseRow {
  rowIndex: number;
  input: GenericVoterInput;
  /** Original columns as the client submitted them (header + value, in order),
   *  so the deliverable can echo their file faithfully with our columns appended. */
  sourceColumns: { h: string; v: string }[];
  record: ParsedFlVoterRecord | null;
  completeness: CompletenessResult | null;
  accepted: boolean;
  rejectReason: string | null;
}

export interface GenericParseResult {
  rows: GenericParseRow[];
  accepted: GenericParseRow[];
  rejected: GenericParseRow[];
}

/** Map many spellings of a column header onto one canonical field. */
const HEADER_ALIASES: Record<keyof GenericVoterInput, string[]> = {
  fullName: ['name', 'fullname', 'votername', 'fullvotername'],
  first: ['first', 'firstname', 'fname', 'givenname'],
  middle: ['middle', 'middlename', 'mname', 'mi'],
  last: ['last', 'lastname', 'lname', 'surname', 'familyname'],
  suffix: ['suffix', 'namesuffix'],
  county: ['county'],
  address: [
    'address',
    'streetaddress',
    'street',
    'residence',
    'residentialaddress',
    'residenceaddress',
    'addr',
    'address1',
    'addressline1',
  ],
  city: ['city', 'town'],
  state: ['state', 'st'],
  zip: ['zip', 'zipcode', 'postal', 'postalcode', 'postcode'],
  dob: ['dob', 'birthdate', 'dateofbirth', 'birth', 'birthday'],
  email: ['email', 'emailaddress', 'e-mail'],
  phone: ['phone', 'telephone', 'phonenumber', 'cell', 'mobile', 'cellphone'],
  employer: ['employer', 'company', 'workplace'],
  occupation: ['occupation', 'job', 'jobtitle', 'title', 'profession'],
  party: ['party', 'partyaffiliation', 'affiliation', 'registration', 'partyreg'],
  voterId: ['voterid', 'voteridnumber', 'flvoterid', 'id', 'registrationnumber'],
};

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildHeaderMap(headers: string[]): Map<number, keyof GenericVoterInput> {
  const lookup = new Map<string, keyof GenericVoterInput>();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [
    keyof GenericVoterInput,
    string[],
  ][]) {
    for (const alias of aliases) lookup.set(alias, field);
  }
  const map = new Map<number, keyof GenericVoterInput>();
  headers.forEach((h, i) => {
    const field = lookup.get(normalizeHeader(h));
    if (field && ![...map.values()].includes(field)) map.set(i, field);
  });
  return map;
}

/** Minimal RFC-4180-ish parser: handles quoted fields, commas/tabs, CRLF. */
function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(value);
      value = '';
    } else if (ch === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (ch === '\r') {
      // swallow — handled by the following \n (or end of input)
    } else {
      value += ch;
    }
  }
  // trailing cell / row (no final newline)
  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function detectDelimiter(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

function cleanName(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(' ');
}

/** Split a "First Middle Last" / "Last, First" full name into components. */
function splitFullName(full: string): { first: string; middle: string; last: string; suffix: string } {
  const trimmed = full.trim();
  if (trimmed.includes(',')) {
    const [lastPart, rest = ''] = trimmed.split(',');
    const restTokens = rest.trim().split(/\s+/).filter(Boolean);
    return {
      last: lastPart.trim(),
      first: restTokens[0] ?? '',
      middle: restTokens.slice(1).join(' '),
      suffix: '',
    };
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const suffixSet = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
  let suffix = '';
  if (tokens.length > 2 && suffixSet.has(tokens[tokens.length - 1].replace(/\./g, '').toLowerCase())) {
    suffix = tokens.pop() as string;
  }
  const first = tokens.shift() ?? '';
  const last = tokens.pop() ?? '';
  const middle = tokens.join(' ');
  return { first, middle, last, suffix };
}

function toRecord(input: GenericVoterInput): ParsedFlVoterRecord {
  const nameParts = input.fullName
    ? splitFullName(input.fullName)
    : {
        first: (input.first ?? '').trim(),
        middle: (input.middle ?? '').trim(),
        last: (input.last ?? '').trim(),
        suffix: (input.suffix ?? '').trim(),
      };
  const full = cleanName([nameParts.first, nameParts.middle, nameParts.last, nameParts.suffix]);

  const line1 = (input.address ?? '').trim();
  const city = (input.city ?? '').trim();
  const state = (input.state ?? 'FL').trim().toUpperCase() || 'FL';
  const zip = (input.zip ?? '').trim();
  const residenceFull = [line1, city, state, zip].filter(Boolean).join(', ');

  return {
    countyCode: (input.county ?? '').trim(),
    voterId: (input.voterId ?? '').trim(),
    name: { ...nameParts, full },
    residence: { line1, line2: '', city, state, zip, full: residenceFull },
    mailing: { line1: '', line2: '', line3: '', city: '', state: '', zip: '', country: '' },
    party: (input.party ?? '').trim().toUpperCase(),
    status: 'ACT',
    precinct: '',
    birthDate: (input.dob ?? '').trim(),
    registrationDate: '',
    phone: (input.phone ?? '').trim() || null,
    email: (input.email ?? '').trim() || null,
    publicRecordsExemption: false,
    suppressed: false,
    raw: [],
    employer: (input.employer ?? '').trim() || null,
    occupation: (input.occupation ?? '').trim() || null,
    sourceType: 'generic',
  };
}

/**
 * Anchor gate: name (first+last or full) + state + >=1 of county / ZIP / street.
 * Returns null when acceptable, else a human-readable reason.
 */
export function anchorRejectReason(record: ParsedFlVoterRecord): string | null {
  const hasName = Boolean(record.name.last && (record.name.first || record.name.full));
  if (!hasName) return 'Missing name (need at least first + last).';
  const hasAnchor = Boolean(
    record.countyCode || record.residence.zip || record.residence.line1,
  );
  if (!hasAnchor) return 'Missing location anchor (need county, ZIP, or street address).';
  return null;
}

function inputFromObject(obj: Record<string, unknown>): GenericVoterInput {
  const out: GenericVoterInput = {};
  const lookup = new Map<string, keyof GenericVoterInput>();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [
    keyof GenericVoterInput,
    string[],
  ][]) {
    for (const alias of aliases) lookup.set(alias, field);
  }
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue;
    const field = lookup.get(normalizeHeader(key));
    if (field && out[field] === undefined) out[field] = String(value).trim();
  }
  return out;
}

function assemble(
  input: GenericVoterInput,
  rowIndex: number,
  sourceColumns: { h: string; v: string }[],
): GenericParseRow {
  const record = toRecord(input);
  const reason = anchorRejectReason(record);
  if (reason) {
    return {
      rowIndex,
      input,
      sourceColumns,
      record: null,
      completeness: null,
      accepted: false,
      rejectReason: reason,
    };
  }
  return {
    rowIndex,
    input,
    sourceColumns,
    record,
    completeness: scoreCompleteness(record),
    accepted: true,
    rejectReason: null,
  };
}

/** Parse a JSON array of row objects. */
export function parseGenericJson(data: unknown): GenericParseResult {
  const arr = Array.isArray(data) ? data : [];
  const rows = arr.map((obj, i) => {
    const record = obj as Record<string, unknown>;
    const sourceColumns = Object.entries(record).map(([h, v]) => ({
      h,
      v: v == null ? '' : String(v),
    }));
    return assemble(inputFromObject(record), i, sourceColumns);
  });
  return partition(rows);
}

/** Parse delimited text (CSV/TSV/pasted) with a header row. */
export function parseGenericDelimited(text: string): GenericParseResult {
  const firstNewline = text.indexOf('\n');
  const headerLine = firstNewline === -1 ? text : text.slice(0, firstNewline);
  const delimiter = detectDelimiter(headerLine);
  const matrix = splitDelimited(text, delimiter);
  if (matrix.length === 0) return { rows: [], accepted: [], rejected: [] };

  const headers = matrix[0].map((h) => h.trim());
  const headerMap = buildHeaderMap(headers);
  const rows: GenericParseRow[] = [];

  for (let r = 1; r < matrix.length; r += 1) {
    const cells = matrix[r];
    if (cells.every((c) => c.trim() === '')) continue; // skip blank lines
    const input: GenericVoterInput = {};
    headerMap.forEach((field, col) => {
      const raw = (cells[col] ?? '').trim();
      if (raw && input[field] === undefined) input[field] = raw;
    });
    // Preserve every original column (mapped or not) for the deliverable echo.
    const sourceColumns = headers.map((h, i) => ({ h, v: (cells[i] ?? '').trim() }));
    rows.push(assemble(input, rows.length, sourceColumns));
  }
  return partition(rows);
}

/** Dispatch on content: JSON array → JSON parser, else delimited. */
export function parseGenericVoterList(content: string): GenericParseResult {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(content);
      return parseGenericJson(Array.isArray(data) ? data : [data]);
    } catch {
      // fall through to delimited on malformed JSON
    }
  }
  return parseGenericDelimited(content);
}

function partition(rows: GenericParseRow[]): GenericParseResult {
  return {
    rows,
    accepted: rows.filter((r) => r.accepted),
    rejected: rows.filter((r) => !r.accepted),
  };
}
