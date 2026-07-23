/**
 * Offline canary for lean precedence (no DB).
 *   npx tsx scripts/smoke-lean-precedence.ts
 */
import {
  resolveDeliverableLean,
  leanFromRegistrationParty,
} from '@/lib/lean-precedence';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function main() {
  assert(leanFromRegistrationParty('DEM') === 'Left', 'DEM→Left');
  assert(leanFromRegistrationParty('REP') === 'Right', 'REP→Right');
  assert(leanFromRegistrationParty('NPA') === null, 'NPA→null');

  // Wallet default: evidence overrides party
  const w = resolveDeliverableLean({
    party: 'DEM',
    evidenceLean: 'Right',
    evidenceConfidence: 95,
    precedence: 'wallet',
  });
  assert(w.lean === 'Right' && w.winner === 'wallet' && w.tension, 'wallet override');

  const r = resolveDeliverableLean({
    party: 'DEM',
    evidenceLean: 'Right',
    evidenceConfidence: 95,
    precedence: 'registration',
  });
  assert(r.lean === 'Left' && r.winner === 'registration' && r.tension, 'reg wins');

  const c = resolveDeliverableLean({
    party: 'REP',
    evidenceLean: 'Left',
    evidenceConfidence: 90,
    precedence: 'conflict_undetermined',
  });
  assert(c.lean === 'Undetermined' && c.winner === 'conflict' && c.tension, 'conflict');

  // Agree
  const a = resolveDeliverableLean({
    party: 'DEM',
    evidenceLean: 'Left',
    evidenceConfidence: 80,
    precedence: 'wallet',
  });
  assert(a.lean === 'Left' && !a.tension, 'agree');

  // NPA + evidence
  const n = resolveDeliverableLean({
    party: 'NPA',
    evidenceLean: 'Right',
    evidenceConfidence: 88,
    precedence: 'wallet',
  });
  assert(n.lean === 'Right' && n.winner === 'wallet', 'npa wallet');

  // Party only
  const p = resolveDeliverableLean({
    party: 'REP',
    evidenceLean: null,
    precedence: 'wallet',
  });
  assert(p.lean === 'Right' && p.winner === 'registration', 'party only');

  console.log('smoke-lean-precedence: OK');
}

main();
