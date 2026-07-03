import { createHash } from 'crypto';

function sha256(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Identity hash for FL DOS extract records, keyed on the state-issued voter ID.
 * Used for legacy uploads where every row carries a canonical voterId.
 */
export function hashVoterPii(parts: {
  voterId: string;
  name: string;
  address: string;
}): string {
  const payload = [parts.voterId, parts.name, parts.address].join('|').toLowerCase();
  return sha256(payload);
}

/**
 * Identity hash for generic client-supplied records that have NO voter ID.
 * Keyed on name + address + DoB (+ county) — the fields a client is asked to
 * provide. Keep this stable: changing the field set re-hashes every record and
 * breaks dedup against prior batches.
 */
export function hashGenericVoter(parts: {
  name: string;
  address: string;
  dob?: string | null;
  county?: string | null;
}): string {
  const payload = [parts.name, parts.address, parts.dob ?? '', parts.county ?? '']
    .join('|')
    .toLowerCase();
  return sha256(payload);
}
