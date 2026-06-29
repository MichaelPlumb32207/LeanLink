/** Shared name/address normalization for bulk reference indexes. */

export function normalizeNameKey(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[.,']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function zip5(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '').slice(0, 5);
}

export function normalizeCity(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\bst\b/g, 'saint')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse "CITY, FL 12345" from FL DOS contrib export. */
export function parseCityStateZip(combined: string | null | undefined): {
  city: string;
  state: string;
  zip5: string;
} {
  if (!combined?.trim()) return { city: '', state: '', zip5: '' };
  const m = combined.match(/^(.+?),\s*([A-Z]{2})\s*(\d{5})(?:-\d{4})?/i);
  if (!m) return { city: normalizeCity(combined), state: 'FL', zip5: '' };
  return {
    city: normalizeCity(m[1]),
    state: m[2].toUpperCase(),
    zip5: m[3],
  };
}

export function entityNameKey(value: string | null | undefined): string {
  return normalizeNameKey(value).replace(/\b(llc|inc|corp|ltd|co)\b/g, '').replace(/\s+/g, ' ').trim();
}