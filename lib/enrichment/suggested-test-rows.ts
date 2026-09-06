/**
 * Curated row_index picks per county upload (0-based among ingested voter_records).
 * Re-validate if ingest filter or source file changes.
 *
 * Notes are scenario labels only — never commit real voter names or emails.
 */
export interface SuggestedTestRow {
  rowIndex: number;
  scenario: string;
  note: string;
}

/** Calhoun CAL upload (~736 NPA ACT rows). */
export const CALHOUN_SUGGESTED_TEST_ROWS: SuggestedTestRow[] = [
  {
    rowIndex: 0,
    scenario: 'Thin OSINT (baseline)',
    note: 'Small town, no contact, medium turnout → Undetermined expected',
  },
  {
    rowIndex: 13,
    scenario: 'Email + phone',
    note: 'Small town, both contact fields on file',
  },
  {
    rowIndex: 7,
    scenario: 'Phone only',
    note: 'Phone but no email',
  },
  {
    rowIndex: 371,
    scenario: 'Largest town + email',
    note: 'County seat, email on file',
  },
  {
    rowIndex: 19,
    scenario: 'Common surname',
    note: 'Disambiguation stress test',
  },
  {
    rowIndex: 208,
    scenario: 'Rural no contact',
    note: 'Unincorporated, no email/phone',
  },
  {
    rowIndex: 32,
    scenario: 'Long / hyphenated name',
    note: 'Name-matching edge case',
  },
];

/** Alachua ALA upload (~40,552 NPA ACT rows). Picked for social-discovery contrast vs Calhoun. */
export const ALACHUA_SUGGESTED_TEST_ROWS: SuggestedTestRow[] = [
  {
    rowIndex: 2,
    scenario: 'Thin OSINT (baseline)',
    note: 'City, no email/phone',
  },
  {
    rowIndex: 114,
    scenario: 'Campus email + phone',
    note: 'Best LinkedIn/social bet in county (contact on file)',
  },
  {
    rowIndex: 6,
    scenario: 'Phone only',
    note: 'Nearby town, phone but no email',
  },
  {
    rowIndex: 4,
    scenario: 'City email + phone',
    note: 'High turnout + primary',
  },
  {
    rowIndex: 332,
    scenario: 'Common surname',
    note: 'Many same-surname rows; email + phone',
  },
  {
    rowIndex: 12,
    scenario: 'Small-town no contact',
    note: 'Small city vs county-seat bulk',
  },
  {
    rowIndex: 52,
    scenario: 'Long / hyphenated name',
    note: 'Email + phone on file',
  },
];

export function suggestedTestRowsForFilename(filename: string | null | undefined): SuggestedTestRow[] {
  const base = (filename ?? '').split(/[/\\]/).pop() ?? '';
  if (/^ALA/i.test(base)) return ALACHUA_SUGGESTED_TEST_ROWS;
  return CALHOUN_SUGGESTED_TEST_ROWS;
}

export function suggestedTestRowsForCountyCode(countyCode: string | null | undefined): SuggestedTestRow[] {
  if (countyCode?.trim().toUpperCase() === 'ALA') return ALACHUA_SUGGESTED_TEST_ROWS;
  return CALHOUN_SUGGESTED_TEST_ROWS;
}
