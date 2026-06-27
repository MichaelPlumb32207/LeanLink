/** Florida DOS 3-letter county codes → display name (67 counties). */
const FL_COUNTY_NAMES: Record<string, string> = {
  ALA: 'Alachua',
  BAK: 'Baker',
  BAY: 'Bay',
  BRA: 'Bradford',
  BRE: 'Brevard',
  BRO: 'Broward',
  CAL: 'Calhoun',
  CHA: 'Charlotte',
  CIT: 'Citrus',
  CLA: 'Clay',
  COLL: 'Collier',
  COL: 'Columbia',
  DAD: 'Miami-Dade',
  DES: 'DeSoto',
  DIX: 'Dixie',
  DUV: 'Duval',
  ESC: 'Escambia',
  FLA: 'Flagler',
  FRA: 'Franklin',
  GAD: 'Gadsden',
  GIL: 'Gilchrist',
  GLA: 'Glades',
  GUL: 'Gulf',
  HAM: 'Hamilton',
  HAR: 'Hardee',
  HEN: 'Hendry',
  HER: 'Hernando',
  HIG: 'Highlands',
  HIL: 'Hillsborough',
  HOL: 'Holmes',
  IND: 'Indian River',
  JAC: 'Jackson',
  JEF: 'Jefferson',
  LAF: 'Lafayette',
  LAK: 'Lake',
  LEE: 'Lee',
  LEO: 'Leon',
  LEV: 'Levy',
  LIB: 'Liberty',
  MAD: 'Madison',
  MAN: 'Manatee',
  MR: 'Marion',
  MRT: 'Martin',
  MON: 'Monroe',
  NAS: 'Nassau',
  OKA: 'Okaloosa',
  OKE: 'Okeechobee',
  ORA: 'Orange',
  OSCE: 'Osceola',
  PAL: 'Palm Beach',
  PAS: 'Pasco',
  PIN: 'Pinellas',
  POL: 'Polk',
  PUT: 'Putnam',
  SAN: 'Santa Rosa',
  SAR: 'Sarasota',
  SEM: 'Seminole',
  STJ: 'St. Johns',
  STL: 'St. Lucie',
  SUM: 'Sumter',
  SUW: 'Suwannee',
  TAY: 'Taylor',
  UNI: 'Union',
  VOL: 'Volusia',
  WAK: 'Wakulla',
  WAL: 'Walton',
  WAS: 'Washington',
};

/** Marion is MR in some extracts and sometimes aliased — normalize common variants. */
const COUNTY_ALIASES: Record<string, string> = {
  MAR: 'MR',
  OCE: 'OSCE',
  MIA: 'DAD',
  OSCEOLA: 'OSCE',
};

export function flCountyName(countyCode: string): string {
  const normalized = countyCode.trim().toUpperCase();
  const key = COUNTY_ALIASES[normalized] ?? normalized;
  return FL_COUNTY_NAMES[key] ?? normalized;
}

export function flCountyLabel(countyCode: string): string {
  const name = flCountyName(countyCode);
  if (name === countyCode.trim().toUpperCase()) return `${name} County`;
  return `${name} County`;
}