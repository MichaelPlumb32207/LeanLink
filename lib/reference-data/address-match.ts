/**
 * Shared street-address corroboration for identity scoring (ENH-012 / ENH-013).
 *
 * Every arm scores identity independently (FEC, FL contrib, Sunbiz) and until
 * now used only zip5 + city + name — which against a 20.6M-row officer corpus
 * is mostly last-name collisions (Duval: 98,650 "confirmed" / 0 settles). The
 * voter's street (`residence.line1`), the officer's (`officer_address`) and the
 * FL contributor's (`address`) are all present at match time. This helper is the
 * ONE place street comparison lives — never re-implement per arm (DEF-005/006
 * lesson). Normalization mirrors `residenceAddressKey` (lib/anchor/household.ts)
 * and extends it: split the leading house number, canonicalize street suffixes
 * and directionals, drop unit fragments.
 */

export interface StreetParts {
  houseNumber: string | null;
  streetTokens: string[];
  /** `<houseNumber> <streetTokens...>` — full normalized comparison key. */
  key: string;
}

export type AddressCorroboration =
  | 'exact' // full key match
  | 'house_and_street' // same house number AND street name (unit residue may differ)
  | 'partial' // same street OR same number, but not both
  | 'mismatch' // both sides have a house number and nothing lines up
  | 'unknown'; // one side missing a usable street — never penalize on missing data

const SUFFIX_CANON: Record<string, string> = {
  st: 'street', street: 'street',
  ave: 'avenue', av: 'avenue', avenue: 'avenue',
  rd: 'road', road: 'road',
  dr: 'drive', drive: 'drive',
  blvd: 'boulevard', boulevard: 'boulevard',
  ln: 'lane', lane: 'lane',
  ct: 'court', court: 'court',
  cir: 'circle', circle: 'circle',
  pl: 'place', place: 'place',
  ter: 'terrace', terr: 'terrace', terrace: 'terrace',
  hwy: 'highway', highway: 'highway',
  pkwy: 'parkway', parkway: 'parkway',
  trl: 'trail', trail: 'trail',
  way: 'way',
};

const DIR_CANON: Record<string, string> = {
  n: 'north', s: 'south', e: 'east', w: 'west',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
  north: 'north', south: 'south', east: 'east', west: 'west',
  northeast: 'northeast', northwest: 'northwest',
  southeast: 'southeast', southwest: 'southwest',
};

/** Split a residential street line into house number + canonical street tokens. */
export function normalizeStreet(line1: string | null | undefined): StreetParts | null {
  if (!line1) return null;
  let s = line1
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  // Drop trailing unit fragments so "123 Main St Apt 4" == "123 Main St".
  s = s.replace(/\b(?:apt|apartment|unit|ste|suite|bldg|building|lot)\b.*$/, '').trim();

  const rawTokens = s.split(' ').filter(Boolean);
  if (rawTokens.length === 0) return null;

  let houseNumber: string | null = null;
  let rest = rawTokens;
  const lead = rawTokens[0].match(/^\d+/);
  if (lead) {
    houseNumber = lead[0];
    rest = rawTokens.slice(1);
  }

  const streetTokens = rest.map((t) => SUFFIX_CANON[t] ?? DIR_CANON[t] ?? t).filter(Boolean);
  if (!houseNumber && streetTokens.length === 0) return null;

  const key = [houseNumber ?? '', ...streetTokens].join(' ').trim();
  return { houseNumber, streetTokens, key };
}

/**
 * How strongly a candidate record's street address corroborates the voter's.
 * Returns `unknown` (not a penalty) when either side lacks a usable street.
 */
export function addressCorroboration(
  voterLine1: string | null | undefined,
  candidateAddress: string | null | undefined,
): AddressCorroboration {
  const a = normalizeStreet(voterLine1);
  const b = normalizeStreet(candidateAddress);
  if (!a || !b) return 'unknown';

  if (a.key === b.key) return 'exact';

  const streetA = a.streetTokens.join(' ');
  const streetB = b.streetTokens.join(' ');
  const sameStreet = streetA.length > 0 && streetA === streetB;
  const sameHouse = a.houseNumber !== null && a.houseNumber === b.houseNumber;

  if (sameHouse && sameStreet) return 'house_and_street';
  if (sameStreet || sameHouse) return 'partial';
  return 'mismatch';
}

/** True only for the two corroboration levels that unlock settle-capable bands. */
export function isAddressCorroborated(level: AddressCorroboration): boolean {
  return level === 'exact' || level === 'house_and_street';
}
