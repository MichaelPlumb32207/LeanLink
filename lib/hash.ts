import { createHash } from 'crypto';

export function hashVoterPii(parts: {
  voterId: string;
  name: string;
  address: string;
}): string {
  const payload = [parts.voterId, parts.name, parts.address].join('|').toLowerCase();
  return createHash('sha256').update(payload).digest('hex');
}