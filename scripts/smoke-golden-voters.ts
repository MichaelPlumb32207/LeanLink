/**
 * Golden-voter canaries (ENH-007) — known-answer synthetic voters through
 * identity → lean → fusion, asserting funnel outcomes. Every fixture pins a
 * defect this pipeline actually shipped with (DEF-005/006, D-030), plus
 * registry-seed parity and the anomaly-band math.
 *
 * Usage:
 *   npx tsx scripts/smoke-golden-voters.ts             # all checks (DB for parity only)
 *   npx tsx scripts/smoke-golden-voters.ts --offline   # pure checks only, no DB
 *
 * All fixtures are synthetic (GOLDEN family, no PII). The DB portion is
 * SELECT-only inside BEGIN/ROLLBACK. Exit code 1 on any failure — CI-able.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { buildFecIndexEvidenceEvent } from '@/lib/evidence/fec-events';
import { buildFlContribEvidenceEvent } from '@/lib/evidence/fl-contrib-events';
import { fuseEvidenceEvents } from '@/lib/evidence/fusion';
import { SCORER_VERSION } from '@/lib/evidence/scorer-version';
import { computeRunAnomalies } from '@/lib/evidence/run-baselines';
import { diffRepassSnapshots, type RepassSnapshot, type VoterFusionState } from '@/lib/evidence/repass-diff';
import type { EvidenceEventInput, EvidenceEventRow } from '@/lib/evidence/types';
import { scoreFecLookupForVoter } from '@/lib/fec/score-lookup-result';
import { inferLeanFromDonations } from '@/lib/fec/donation-lean';
import { committeeNameNorm } from '@/lib/committee-lean/normalize';
import type { FecContributionHit } from '@/lib/fec/contributor-lookup';
import { scoreFlContributionsAgainstVoter } from '@/lib/fl-contrib/identity-match';
import type { FlContributionHit } from '@/lib/fl-contrib/types';
import { buildSunbizEvidenceEvent } from '@/lib/evidence/sunbiz-events';
import { scoreSunbizOfficerMatch, sunbizIdentityBand } from '@/lib/sunbiz/lookup';
import type { SunbizOfficerHit } from '@/lib/sunbiz/lookup';
import { inferLeanFromCommitteeName } from '@/lib/committee-lean/infer';
import {
  FALLBACK_LEAN_PATTERN_ROWS,
  getFallbackLeanPatterns,
  scanLeanPatterns,
  type LeanPatternSets,
} from '@/lib/lean-patterns/patterns';
import { loadLeanPatterns } from '@/lib/lean-patterns/registry';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

function ok(cond: boolean, label: string) {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) process.exitCode = 1;
}

function goldenVoter(overrides?: Partial<{
  first: string;
  last: string;
  zip: string;
  city: string;
}>): ParsedFlVoterRecord {
  const first = overrides?.first ?? 'Alex';
  const last = overrides?.last ?? 'Golden';
  const zip = overrides?.zip ?? '32202';
  const city = overrides?.city ?? 'Jacksonville';
  return {
    countyCode: 'DUV',
    voterId: 'GOLDEN000001',
    name: { last, suffix: '', first, middle: 'Q', full: `${first} Q ${last}` },
    residence: {
      line1: '100 Synthetic Way',
      line2: '',
      city,
      state: 'FL',
      zip,
      full: `100 Synthetic Way, ${city}, FL, ${zip}`,
    },
    mailing: { line1: '', line2: '', line3: '', city: '', state: '', zip: '', country: '' },
    party: 'NPA',
    status: 'ACT',
    precinct: '000',
    birthDate: '01/01/1970',
    registrationDate: '01/01/2000',
    phone: null,
    email: null,
    publicRecordsExemption: false,
    suppressed: false,
    raw: [],
  };
}

function fecHit(overrides: Partial<FecContributionHit>): FecContributionHit {
  return {
    receipt_date: '2024-03-01',
    amount: 100,
    contributor_name: 'GOLDEN ALEX Q',
    contributor_city: 'JACKSONVILLE',
    contributor_state: 'FL',
    contributor_zip: '32202',
    contributor_employer: null,
    contributor_occupation: null,
    committee_name: null,
    candidate_name: null,
    fec_url: 'https://www.fec.gov/data/receipts/individual-contributions/?sub_id=GOLDEN1',
    ...overrides,
  };
}

function flHit(overrides: Partial<FlContributionHit>): FlContributionHit {
  return {
    id: 'golden-fl-1',
    snapshot_id: 'golden-snap',
    contributor_name: 'GOLDEN ALEX Q',
    address: '100 SYNTHETIC WAY',
    city: 'JACKSONVILLE',
    state: 'FL',
    zip5: '32202',
    amount: 250,
    contribution_date: '2024-02-01',
    committee_name: null,
    contribution_type: 'CHE',
    occupation: null,
    ...overrides,
  } as FlContributionHit;
}

function officerRow(
  overrides: Partial<Omit<SunbizOfficerHit, 'match_score' | 'match_reasons'>>,
): Omit<SunbizOfficerHit, 'match_score' | 'match_reasons'> {
  return {
    id: 'golden-officer-1',
    snapshot_id: 'golden-snap',
    corp_number: 'P00000001',
    corp_name: 'SYNTHETIC HOLDINGS LLC',
    corp_status: 'ACTIVE',
    filing_type: 'llc',
    officer_title: 'PRES',
    officer_name: 'ALEX GOLDEN', // parsed as first=alex, last=golden → matches goldenVoter
    officer_city: 'JACKSONVILLE',
    officer_zip5: '32202',
    officer_address: '100 SYNTHETIC WAY',
    ...overrides,
  };
}

/** Feed a builder's EvidenceEventInput into pure fusion as a persisted-row stand-in. */
function toEventRow(input: EvidenceEventInput, i: number): EvidenceEventRow {
  return {
    id: `golden-${i}`,
    upload_id: input.upload_id,
    voter_record_id: input.voter_record_id,
    user_id: input.user_id,
    arm: input.arm,
    source: input.source,
    identity_band: input.identity_band ?? null,
    identity_score: input.identity_score ?? null,
    probable_same_person: input.probable_same_person ?? false,
    lean_signal: input.lean_signal ?? null,
    lean_confidence: input.lean_confidence ?? null,
    evidence: input.evidence ?? [],
    urls: input.urls ?? [],
    payload: input.payload ?? null,
    cost_usd: input.cost_usd ?? null,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

const EVENT_IDS = { upload_id: 'golden-upload', voter_record_id: 'golden-voter', user_id: 'golden@example.com' };

function buildFecEvent(voter: ParsedFlVoterRecord, hits: FecContributionHit[]) {
  const scored = scoreFecLookupForVoter({
    voter,
    contributions: hits,
    matchLevel: hits.length ? 'strict' : 'none',
  });
  const event = buildFecIndexEvidenceEvent({
    ...EVENT_IDS,
    voter,
    scored,
    has_hits: hits.length > 0,
    names_tried: ['golden alex'],
    snapshot_label: 'golden-fixture',
  });
  return { scored, event };
}

async function main() {
  const offline = process.argv.includes('--offline');
  console.log('— Golden voters (synthetic fixtures; no PII) —');

  // (a) DEF-005 regression: party-coded FEC committee + confirmed identity → lean fires.
  // Two receipts each: aggregate confidence divides by max(1, Σ identity_score),
  // so a single receipt deflates to round(82 × s) — two receipts (Σs > 1) hold
  // the full 82, matching the real multi-receipt donors (Irvine/Yutzy shape).
  {
    const voter = goldenVoter();
    const dem = buildFecEvent(voter, [
      fecHit({ committee_name: 'TRISHA FOR FLORIDA (DEM)' }),
      fecHit({ committee_name: 'TRISHA FOR FLORIDA (DEM)', receipt_date: '2024-04-01' }),
    ]);
    ok(dem.scored.identity.probable_same_person, '(a) matching name+zip+city → identity confirmed');
    ok(dem.scored.fec_lean === 'Left' && dem.scored.fec_lean_confidence === 82, '(a) "(DEM)" committee → Left @82 (DEF-005)');
    const rep = buildFecEvent(voter, [
      fecHit({ committee_name: 'SMITH FOR SENATE (REP)' }),
      fecHit({ committee_name: 'SMITH FOR SENATE (REP)', receipt_date: '2024-04-01' }),
    ]);
    ok(rep.scored.fec_lean === 'Right' && rep.scored.fec_lean_confidence === 82, '(a) "(REP)" committee → Right @82');
    const fusion = fuseEvidenceEvents([toEventRow(dem.event, 1)]);
    ok(fusion.lean === 'Left' && fusion.fusion_status !== 'undetermined', '(a) fused lean Left from the confirmed event');
  }

  // (b) DEF-006 regression: FL party-coded candidate committees classify via patterns.
  {
    const right = inferLeanFromCommitteeName('DeSantis, Ron  (REP)(GOV)');
    ok(right?.lean === 'Right' && right.confidence === 82 && right.source === 'pattern', '(b) "DeSantis, Ron (REP)(GOV)" → Right @82 (DEF-006)');
    const left = inferLeanFromCommitteeName('Crist, Charlie  (DEM)(GOV)');
    ok(left?.lean === 'Left' && left.confidence === 82, '(b) "Crist, Charlie (DEM)(GOV)" → Left @82');
    const voter = goldenVoter();
    const hits = [flHit({ committee_name: 'Crist, Charlie  (DEM)(GOV)' })];
    const identity = scoreFlContributionsAgainstVoter({ voter, hits, match_layer: 1 });
    const event = buildFlContribEvidenceEvent({
      ...EVENT_IDS,
      identity,
      hits,
      match_layer: 1,
      snapshot_label: 'golden-fixture',
    });
    ok(identity.probable_same_person, '(b) FL layer-1 name+zip+city → identity clears the gate');
    ok(event.lean_signal === 'Left', '(b) FL event carries the Left lean signal');
    ok((event.payload?.unresolved_committees as string[]).length === 0, '(b) party-coded committee is NOT unresolved');
  }

  // (c) Conduit committees.
  {
    ok(inferLeanFromCommitteeName('ACTBLUE')?.confidence === 90, '(c) ACTBLUE → Left @90');
    ok(inferLeanFromCommitteeName('WINRED')?.lean === 'Right', '(c) WINRED → Right');
  }

  // (d) Identity gate: same name, wrong geography → no lean, no receipts.
  {
    const voter = goldenVoter();
    const { scored, event } = buildFecEvent(voter, [
      fecHit({
        committee_name: 'TRISHA FOR FLORIDA (DEM)',
        contributor_city: 'BEVERLY HILLS',
        contributor_state: 'CA',
        contributor_zip: '90210',
      }),
    ]);
    ok(!scored.identity.probable_same_person, '(d) same-name wrong-zip stays unconfirmed');
    ok(scored.fec_lean === null, '(d) no lean emitted without identity');
    ok(!event.evidence?.some((l) => l.includes('→')), '(d) no itemized receipt lines for unconfirmed hits');
  }

  // (e) Mixed confirmed signals → conflicted / Undetermined.
  {
    const voter = goldenVoter();
    const leftEvent = buildFecEvent(voter, [fecHit({ committee_name: 'GOLD LEFT COMMITTEE (DEM)' })]).event;
    const hits = [flHit({ committee_name: 'GOLD RIGHT COMMITTEE (REP)' })];
    const identity = scoreFlContributionsAgainstVoter({ voter, hits, match_layer: 1 });
    const rightEvent = buildFlContribEvidenceEvent({
      ...EVENT_IDS,
      identity,
      hits,
      match_layer: 1,
      snapshot_label: 'golden-fixture',
    });
    const fusion = fuseEvidenceEvents([toEventRow(leftEvent, 2), toEventRow(rightEvent, 3)]);
    ok(fusion.fusion_status === 'conflicted' && fusion.lean === 'Undetermined', '(e) equal-strength Left + Right → conflicted/Undetermined');
  }

  // (f) D-030 regression: confirmed employer-PAC donor → no lean, but itemized receipts + scorer_v.
  {
    const voter = goldenVoter();
    const { scored, event } = buildFecEvent(voter, [
      fecHit({ committee_name: 'ACME CORP EMPLOYEE PAC', amount: 500 }),
    ]);
    ok(scored.identity.probable_same_person && scored.fec_lean === null, '(f) employer PAC: confirmed identity, no lean');
    ok(Boolean(event.evidence?.some((l) => /\$500 → ACME CORP EMPLOYEE PAC/.test(l))), '(f) receipts itemized in evidence (D-030)');
    ok(Array.isArray(event.payload?.receipts) && (event.payload?.receipts as unknown[]).length === 1, '(f) payload.receipts populated');
    ok(event.payload?.scorer_v === SCORER_VERSION, `(f) payload.scorer_v === ${SCORER_VERSION}`);
  }

  // (i) ENH-012: Sunbiz officer at the voter's own street → confirmed, bridge-eligible.
  {
    const voter = goldenVoter();
    const { score, corroboration } = scoreSunbizOfficerMatch(voter, officerRow({}));
    ok(
      corroboration === 'exact' && sunbizIdentityBand(score) === 'confirmed',
      '(i) Sunbiz name+zip+street match → confirmed (ENH-012)',
    );
  }

  // (j) ENH-012: name+zip collision with a DIFFERENT street → capped at ambiguous,
  // never settles. This is the exact 98,650-hit / 0-settle Duval shape.
  {
    const voter = goldenVoter();
    const row = officerRow({ officer_address: '999 DIFFERENT BLVD' });
    const { score, reasons, corroboration } = scoreSunbizOfficerMatch(voter, row);
    ok(
      corroboration === 'mismatch' && score <= 0.54 && sunbizIdentityBand(score) === 'ambiguous',
      '(j) Sunbiz name+zip collision, wrong street → ambiguous, capped (98k-noise shape)',
    );
    const hit: SunbizOfficerHit = { ...row, match_score: score, match_reasons: reasons };
    const event = buildSunbizEvidenceEvent({ ...EVENT_IDS, hits: [hit], snapshot_label: 'golden-fixture' });
    ok(
      event !== null && event.identity_band === 'ambiguous' && event.probable_same_person === false,
      '(j) collision event never clears the identity gate → cannot settle',
    );
  }

  // (k) ENH-013: street corroboration lifts an otherwise-weak FL match into probable.
  {
    const voter = goldenVoter();
    const now = new Date('2026-07-06T00:00:00Z');
    const bare = flHit({ contributor_name: 'TAYLOR GOLDEN', zip5: null, city: null, address: null });
    const withStreet = flHit({ contributor_name: 'TAYLOR GOLDEN', zip5: null, city: null, address: '100 SYNTHETIC WAY' });
    const idBare = scoreFlContributionsAgainstVoter({ voter, hits: [bare], match_layer: 1, now });
    const idStreet = scoreFlContributionsAgainstVoter({ voter, hits: [withStreet], match_layer: 1, now });
    ok(idBare.identity_band === 'ambiguous' && !idBare.probable_same_person, '(k) name-only FL match stays ambiguous without street');
    ok(idStreet.identity_band === 'probable' && idStreet.probable_same_person, '(k) same match + street corroboration → probable (ENH-013)');
  }

  // (l) ENH-013: a stale zip match scores below a recent one (address churn).
  {
    const voter = goldenVoter();
    const now = new Date('2026-07-06T00:00:00Z');
    const recent = flHit({ contributor_name: 'TAYLOR GOLDEN', address: null, city: null, contribution_date: '2024-06-01' });
    const old = flHit({ contributor_name: 'TAYLOR GOLDEN', address: null, city: null, contribution_date: '2008-06-01' });
    const idRecent = scoreFlContributionsAgainstVoter({ voter, hits: [recent], match_layer: 1, now });
    const idOld = scoreFlContributionsAgainstVoter({ voter, hits: [old], match_layer: 1, now });
    ok(idRecent.identity_score > idOld.identity_score, '(l) stale zip match scores below a recent one (ENH-013 recency)');
  }

  // (h) Anomaly-band math (ENH-006): the Duval Tier-2 zero-settle shape must flag.
  {
    const priors = [
      { arm: 'fl_contrib', runner: 'x', processed_count: 40000, hits_count: 4000, confirmed_count: 400, lean_signal_count: 300 },
    ];
    const flagged = computeRunAnomalies(
      { arm: 'fl_contrib', processed_count: 1200, hits_count: 10, confirmed_count: 1, lean_signal_count: 0 },
      priors,
    );
    ok(flagged.some((f) => f.startsWith('hit rate')) && flagged.some((f) => f.startsWith('lean rate')), '(h) zero-settle shape flags hit + lean anomalies');
    const belowFloor = computeRunAnomalies(
      { arm: 'fl_contrib', processed_count: 500, hits_count: 0, confirmed_count: 0, lean_signal_count: 0 },
      priors,
    );
    ok(belowFloor.length === 0, '(h) below the 1,000-processed floor → silent');
    const healthy = computeRunAnomalies(
      { arm: 'fl_contrib', processed_count: 2000, hits_count: 210, confirmed_count: 22, lean_signal_count: 16 },
      priors,
    );
    ok(healthy.length === 0, '(h) healthy run within bands → no flags');
  }

  // (m) ENH-010 re-pass diff math: the Duval Sunbiz supersede shape (DEF-009) —
  // a tightened re-pass drops stale leans and adds address-backed settles.
  {
    const v = (
      id: string,
      row: number,
      lean: VoterFusionState['lean'],
      confidence: number,
      settled_tier: number | null,
      settled_arm: string | null,
    ): VoterFusionState => ({
      voter_record_id: id,
      row_index: row,
      lean,
      confidence,
      fusion_status: settled_tier != null ? 'fused' : lean === 'Undetermined' ? 'undetermined' : 'provisional',
      settled_tier,
      settled_arm,
      review_status: null,
      arms: settled_arm ?? '',
    });
    const mk = (voters: VoterFusionState[], sv: number): RepassSnapshot => ({
      upload_id: 'u1',
      captured_at: '2026-07-06T00:00:00Z',
      scorer_v: sv,
      voter_count: voters.length,
      voters,
    });
    // before: two stale bridge-leans (Right) + one real FEC settle + one frozen.
    const before = mk(
      [
        v('a', 1, 'Right', 70, null, null), // stale layer-2 lean, not settled
        v('b', 2, 'Right', 65, null, null), // stale layer-2 lean, not settled
        v('c', 3, 'Left', 88, 1, 'fec'), // real settle, unchanged
        { ...v('d', 4, 'Left', 90, 1, 'fec'), review_status: 'accepted' }, // frozen
      ],
      2,
    );
    // after v3: a & b lose the spurious lean; a new address-backed Sunbiz settle appears on b? No —
    // model it as: a→Undetermined (supersede), b→Undetermined, plus e is a fresh confirmed voter.
    const after = mk(
      [
        v('a', 1, 'Undetermined', 0, null, null),
        v('b', 2, 'Undetermined', 0, null, null),
        v('c', 3, 'Left', 88, 1, 'fec'),
        { ...v('d', 4, 'Left', 90, 1, 'fec'), review_status: 'accepted' },
      ],
      3,
    );
    const d = diffRepassSnapshots(before, after);
    ok(d.leans_lost === 2 && d.leans_gained === 0, '(m) supersede drops 2 spurious leans, adds none');
    ok(d.settles_gained === 0 && d.settles_lost === 0, '(m) real + frozen settles untouched');
    ok(d.frozen_skipped === 1, '(m) accepted voter counted as frozen');
    ok(d.net_partisan_after === d.net_partisan_before - 2, '(m) net partisan drops by 2');
    ok(d.before_scorer_v === 2 && d.after_scorer_v === 3, '(m) scorer_v carried through the diff');
    ok(d.notable.length === 2 && d.notable.every((n) => n.to === 'Undetermined'), '(m) notable lists the two lost leans');
  }

  // (n) ENH-018: a committee label recovers a FEC lean the party-code/pattern
  // path can't reach — the Lincoln Project / Harris Victory Fund shape. Same
  // donor, once with no label (Undetermined) and once with a Left label.
  {
    const scored = [
      {
        contribution: {
          receipt_date: '2024-10-07',
          amount: 300,
          contributor_name: 'DOE, JANE',
          contributor_city: 'Jacksonville',
          contributor_state: 'FL',
          contributor_zip: '32207',
          contributor_employer: null,
          contributor_occupation: null,
          committee_name: 'HARRIS VICTORY FUND', // no party code, no pattern
          candidate_name: null,
          fec_url: null,
        },
        identity_score: 0.9,
        match_reasons: ['zip5_match'],
        probable_same_person: true,
      },
    ];
    const patterns = getFallbackLeanPatterns();
    const unlabeled = inferLeanFromDonations(scored, { patterns });
    ok(unlabeled.lean === 'Undetermined', '(n) unlabeled committee → Undetermined (the missed-signal case)');

    const labels = new Map([
      [committeeNameNorm('HARRIS VICTORY FUND'), { committee_name_norm: committeeNameNorm('HARRIS VICTORY FUND'), lean: 'Left' as const, confidence: 90, notes: 'Kamala Harris JFC' }],
    ]);
    const labeled = inferLeanFromDonations(scored, { patterns, researcherLabels: labels });
    ok(labeled.lean === 'Left' && labeled.lean_signals_found, '(n) same donor + committee label → Left recovered');
  }

  // (g) Registry-seed parity (DB): the DB patterns must classify identically to the fallback.
  if (offline) {
    console.log('… (g) registry parity skipped (--offline)');
  } else {
    loadEnvLocal();
    const userEmail = process.env.ALLOWED_USER_EMAIL;
    if (!userEmail || !process.env.DATABASE_URL) {
      ok(false, '(g) ALLOWED_USER_EMAIL / DATABASE_URL missing — run with --offline to skip');
    } else {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
        const db: LeanPatternSets = await loadLeanPatterns(client, userEmail);
        ok(db.meta.source === 'db', `(g) registry loads from DB (${db.meta.rowCount} rows)`);
        ok(db.meta.invalidCount === 0, '(g) zero invalid patterns in DB');
        ok(db.meta.rowCount === FALLBACK_LEAN_PATTERN_ROWS.length, `(g) row count matches fallback (${FALLBACK_LEAN_PATTERN_ROWS.length})`);
        const probes = [
          'TRISHA FOR FLORIDA (DEM)', 'SMITH FOR SENATE (REP)', 'DeSantis, Ron  (REP)(GOV)',
          'Crist, Charlie  (DEM)(GOV)', 'ACTBLUE', 'WINRED', 'ACME CORP EMPLOYEE PAC',
          'REPUBLICAN PARTY OF FLORIDA (PTY)', 'WINRED REPUBLICAN FUND', "EMILY'S LIST",
          'MOVEON.ORG', 'BIPARTISAN POLICY COMMITTEE', 'MAGA INC', 'MN DFL HOUSE CAUCUS (DFL)',
          'FLORIDA DEMOCRATIC PARTY', 'LIBERTY FIRST PAC', 'KATHERINE HARRIS FOR CONGRESS',
        ];
        const fallback = getFallbackLeanPatterns();
        let mismatches = 0;
        for (const probe of probes) {
          for (const scope of ['fec', 'fl'] as const) {
            const a = scanLeanPatterns(probe, db[scope]);
            const b = scanLeanPatterns(probe, fallback[scope]);
            const same =
              (a === null && b === null) ||
              (a !== null && b !== null && a.lean === b.lean && a.confidence === b.confidence && a.label === b.label);
            if (!same) {
              mismatches += 1;
              console.log(`  ✗ parity mismatch [${scope}] "${probe}": db=${JSON.stringify(a)} fallback=${JSON.stringify(b)}`);
            }
          }
        }
        ok(mismatches === 0, `(g) DB and fallback classify ${probes.length} probes identically in both scopes`);
        await client.query('ROLLBACK');
      } finally {
        client.release();
        await pool.end();
      }
    }
  }

  console.log(process.exitCode === 1 ? '\nGolden voters FAILED' : '\nGolden voters verified.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
