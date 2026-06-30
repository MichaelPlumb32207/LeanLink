import { normalizeNameKey } from '@/lib/reference-data/normalize';

/** Stable key for committee name lookups and researcher labels. */
export function committeeNameNorm(value: string | null | undefined): string {
  return normalizeNameKey(value);
}