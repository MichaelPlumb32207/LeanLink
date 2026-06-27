/**
 * Curated row_index picks per county upload (0-based among ingested voter_records).
 * Re-validate if ingest filter or source file changes.
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
    note: 'Ezra Thomas Childs — Altha, no contact, medium turnout → Undetermined expected',
  },
  {
    rowIndex: 13,
    scenario: 'Email + phone',
    note: 'Mary Alice Partridge — Altha, both contact fields on file',
  },
  {
    rowIndex: 7,
    scenario: 'Phone only',
    note: 'Mark Russell Tadlock — Fountain, phone but no email',
  },
  {
    rowIndex: 371,
    scenario: 'Blountstown + email',
    note: 'Michael Lee Ward — largest town, email on file',
  },
  {
    rowIndex: 19,
    scenario: 'Common surname',
    note: 'Sheffield Tyrone Smith — disambiguation stress test',
  },
  {
    rowIndex: 208,
    scenario: 'Rural no contact',
    note: 'Gatha Darecer White — Kinard, no email/phone',
  },
  {
    rowIndex: 32,
    scenario: 'Long / hyphenated name',
    note: 'Maria Del Rosario Trejo Gonzalez — Altha, name matching edge case',
  },
];

/** Alachua ALA upload (~40,552 NPA ACT rows). Picked for social-discovery contrast vs Calhoun. */
export const ALACHUA_SUGGESTED_TEST_ROWS: SuggestedTestRow[] = [
  {
    rowIndex: 2,
    scenario: 'Thin OSINT (baseline)',
    note: 'Janelle Rayjean Steward — Gainesville, no email/phone',
  },
  {
    rowIndex: 114,
    scenario: 'UF email + phone',
    note: 'Marie Nancy Seraphin — nseraphin@ufl.edu, best LinkedIn/social bet in county',
  },
  {
    rowIndex: 6,
    scenario: 'Phone only',
    note: "Hannah Nicole O'Neill — Newberry, phone but no email",
  },
  {
    rowIndex: 4,
    scenario: 'Gainesville email + phone',
    note: 'Alexandra Elizabeth Meier — DNCNGVET07@YAHOO.COM, high turnout + primary',
  },
  {
    rowIndex: 332,
    scenario: 'Common surname',
    note: 'Evan Bailey Johnson — ~248 Johnsons in file, email + phone',
  },
  {
    rowIndex: 12,
    scenario: 'Small-town no contact',
    note: 'Erica Ashley Ramirez — Alachua (city), no contact vs Gainesville bulk',
  },
  {
    rowIndex: 52,
    scenario: 'Long / hyphenated name',
    note: 'Jean-Paul William Perez — jeanpaul.w.perez@gmail.com + phone',
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