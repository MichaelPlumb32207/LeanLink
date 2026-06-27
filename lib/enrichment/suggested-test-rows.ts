/**
 * Curated row_index picks for Calhoun CAL upload (~736 NPA ACT rows).
 * Indices are 0-based among ingested voter_records ordered by row_index.
 * Re-validate if ingest filter or source file changes.
 */
export interface SuggestedTestRow {
  rowIndex: number;
  scenario: string;
  note: string;
}

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