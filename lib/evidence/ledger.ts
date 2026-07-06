import { CLAIM_ELIGIBLE_PREDICATE } from '@/lib/evidence/arm-runs';
import { inferLeanFromCommitteeName } from '@/lib/committee-lean/infer';
import { loadResearcherCommitteeLabels } from '@/lib/committee-lean/store';
import { fuseEvidenceEvents } from '@/lib/evidence/fusion';
import { computeSettlement } from '@/lib/evidence/settlement';
import { getUploadAccountId, chargeSettlement } from '@/lib/billing/ledger';
import { resolveRates, tierRate } from '@/lib/billing/rates';
import type {
  ArmRunSummary,
  EvidenceEventInput,
  EvidenceEventRow,
  FusionResult,
  UploadEvidenceSummary,
} from '@/lib/evidence/types';
import type { PoolClient } from 'pg';

function parseEventRow(row: Record<string, unknown>): EvidenceEventRow {
  return {
    id: String(row.id),
    upload_id: String(row.upload_id),
    voter_record_id: String(row.voter_record_id),
    user_id: String(row.user_id),
    arm: row.arm as EvidenceEventRow['arm'],
    source: String(row.source),
    identity_band: (row.identity_band as EvidenceEventRow['identity_band']) ?? null,
    identity_score: row.identity_score != null ? Number(row.identity_score) : null,
    probable_same_person: Boolean(row.probable_same_person),
    lean_signal: (row.lean_signal as EvidenceEventRow['lean_signal']) ?? null,
    lean_confidence: row.lean_confidence != null ? Number(row.lean_confidence) : null,
    evidence: Array.isArray(row.evidence) ? row.evidence.map(String) : [],
    urls: Array.isArray(row.urls) ? row.urls.map(String) : [],
    payload: (row.payload as Record<string, unknown>) ?? null,
    cost_usd: row.cost_usd != null ? Number(row.cost_usd) : null,
    created_at: String(row.created_at),
  };
}

export async function appendEvidenceEvent(
  client: PoolClient,
  input: EvidenceEventInput,
): Promise<EvidenceEventRow | null> {
  const dedupe_key = input.dedupe_key ?? '';

  const res = await client.query(
    `INSERT INTO evidence_events
       (upload_id, voter_record_id, user_id, arm, source,
        identity_band, identity_score, probable_same_person,
        lean_signal, lean_confidence, evidence, urls, payload, dedupe_key, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (voter_record_id, arm, source, dedupe_key)
     DO UPDATE SET
       identity_band = EXCLUDED.identity_band,
       identity_score = EXCLUDED.identity_score,
       probable_same_person = EXCLUDED.probable_same_person,
       lean_signal = EXCLUDED.lean_signal,
       lean_confidence = EXCLUDED.lean_confidence,
       evidence = EXCLUDED.evidence,
       urls = EXCLUDED.urls,
       payload = EXCLUDED.payload,
       cost_usd = EXCLUDED.cost_usd,
       created_at = NOW()
     RETURNING *`,
    [
      input.upload_id,
      input.voter_record_id,
      input.user_id,
      input.arm,
      input.source,
      input.identity_band ?? null,
      input.identity_score ?? null,
      input.probable_same_person ?? false,
      input.lean_signal ?? null,
      input.lean_confidence ?? null,
      JSON.stringify(input.evidence ?? []),
      JSON.stringify(input.urls ?? []),
      input.payload ? JSON.stringify(input.payload) : null,
      dedupe_key,
      input.cost_usd ?? null,
    ],
  );

  return res.rows[0] ? parseEventRow(res.rows[0]) : null;
}

export async function listEvidenceForVoter(
  client: PoolClient,
  voterRecordId: string,
): Promise<EvidenceEventRow[]> {
  const res = await client.query(
    `SELECT * FROM evidence_events
     WHERE voter_record_id = $1
     ORDER BY created_at DESC`,
    [voterRecordId],
  );
  return res.rows.map(parseEventRow);
}

export async function persistFusionForVoter(
  client: PoolClient,
  voterRecordId: string,
  uploadId: string,
  userId: string,
  fusion: FusionResult,
): Promise<void> {
  // Researcher acceptance freezes the deliverable values: evidence may still
  // accumulate (manual tests, late arm results), but fusion stops rewriting
  // lean/confidence and nothing new settles or bills.
  const review = await client.query<{ review_status: string | null }>(
    `SELECT review_status FROM voter_lean_fusion WHERE voter_record_id = $1`,
    [voterRecordId],
  );
  if (review.rows[0]?.review_status === 'accepted') return;

  await client.query(
    `INSERT INTO voter_lean_fusion
       (voter_record_id, upload_id, user_id, lean, confidence, fusion_status,
        contributing_arms, evidence_summary, event_count, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (voter_record_id) DO UPDATE SET
       lean = EXCLUDED.lean,
       confidence = EXCLUDED.confidence,
       fusion_status = EXCLUDED.fusion_status,
       contributing_arms = EXCLUDED.contributing_arms,
       evidence_summary = EXCLUDED.evidence_summary,
       event_count = EXCLUDED.event_count,
       updated_at = NOW()`,
    [
      voterRecordId,
      uploadId,
      userId,
      fusion.lean,
      fusion.confidence,
      fusion.fusion_status,
      JSON.stringify(fusion.contributing_arms),
      JSON.stringify(fusion.evidence_summary),
      fusion.event_count,
    ],
  );

  // Waterfall settlement: set once, at the cheapest arm that cleared the bar.
  // The pipeline runs arms cheap→expensive and re-fuses after each, so the first
  // crossing is the cheapest tier. `WHERE settled_tier IS NULL` makes it sticky.
  const settlement = computeSettlement(fusion);
  if (settlement) {
    const settled = await client.query(
      `UPDATE voter_lean_fusion
       SET settled_arm = $2, settled_tier = $3, settled_at = NOW()
       WHERE voter_record_id = $1 AND settled_tier IS NULL`,
      [voterRecordId, settlement.arm, settlement.tier],
    );

    // Bill the tier success fee exactly once, at the moment of settlement, and
    // only for batches that bill to an account. Tier 0 (party prior) is free.
    if (settled.rowCount === 1 && settlement.tier > 0) {
      const accountId = await getUploadAccountId(client, uploadId);
      if (accountId) {
        const rates = await resolveRates(client, accountId);
        await chargeSettlement(client, {
          userId,
          accountId,
          uploadId,
          voterRecordId,
          arm: settlement.arm,
          tier: settlement.tier,
          amount: tierRate(rates, settlement.tier),
          note: `${settlement.arm} lean settled (tier ${settlement.tier})`,
        });
      }
    }
  }

  if (fusion.fusion_status === 'fused' || fusion.fusion_status === 'provisional') {
    const voterHashRes = await client.query<{ voter_hash: string }>(
      `SELECT voter_hash FROM voter_records WHERE id = $1`,
      [voterRecordId],
    );
    const voter_hash = voterHashRes.rows[0]?.voter_hash;
    if (!voter_hash) return;

    await client.query(
      `INSERT INTO lean_results
         (upload_id, voter_record_id, user_id, voter_hash, lean, confidence, evidence, audit_log)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (voter_record_id) DO UPDATE SET
         lean = EXCLUDED.lean,
         confidence = EXCLUDED.confidence,
         evidence = EXCLUDED.evidence,
         audit_log = EXCLUDED.audit_log`,
      [
        uploadId,
        voterRecordId,
        userId,
        voter_hash,
        fusion.lean,
        fusion.confidence,
        JSON.stringify(fusion.evidence_summary),
        JSON.stringify({
          fusion_status: fusion.fusion_status,
          contributing_arms: fusion.contributing_arms,
          source: 'evidence_accumulator',
          updated_at: new Date().toISOString(),
        }),
      ],
    );
  }
}

export async function fuseAndPersistVoter(
  client: PoolClient,
  voterRecordId: string,
  uploadId: string,
  userId: string,
): Promise<FusionResult> {
  const events = await listEvidenceForVoter(client, voterRecordId);
  const fusion = fuseEvidenceEvents(events);
  await persistFusionForVoter(client, voterRecordId, uploadId, userId, fusion);
  return fusion;
}

export async function getUploadEvidenceSummary(
  client: PoolClient,
  uploadId: string,
  userId: string,
): Promise<UploadEvidenceSummary> {
  const voterCountRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM voter_records WHERE upload_id = $1 AND user_id = $2`,
    [uploadId, userId],
  );

  const armRes = await client.query<{
    arm: string;
    event_count: string;
    probable_match_count: string;
    lean_signal_count: string;
    total_cost: string | null;
    voters_touched: string;
    voters_confirmed: string;
    voters_with_lean: string;
    last_event_at: string | null;
  }>(
    `SELECT arm,
            COUNT(*)::text AS event_count,
            COUNT(*) FILTER (WHERE probable_same_person)::text AS probable_match_count,
            COUNT(*) FILTER (WHERE lean_signal IS NOT NULL AND lean_signal != 'Undetermined')::text AS lean_signal_count,
            SUM(cost_usd)::text AS total_cost,
            COUNT(DISTINCT voter_record_id)::text AS voters_touched,
            COUNT(DISTINCT voter_record_id) FILTER (WHERE probable_same_person)::text AS voters_confirmed,
            COUNT(DISTINCT voter_record_id) FILTER (WHERE lean_signal IS NOT NULL AND lean_signal != 'Undetermined')::text AS voters_with_lean,
            MAX(created_at)::text AS last_event_at
     FROM evidence_events
     WHERE upload_id = $1 AND user_id = $2
     GROUP BY arm`,
    [uploadId, userId],
  );

  const fusionRes = await client.query<{
    fusion_status: string;
    lean: string;
    count: string;
  }>(
    `SELECT fusion_status, lean, COUNT(*)::text AS count
     FROM voter_lean_fusion
     WHERE upload_id = $1 AND user_id = $2
     GROUP BY fusion_status, lean`,
    [uploadId, userId],
  );

  const settledRes = await client.query<{
    settled_tier: number;
    settled_arm: string | null;
    count: string;
  }>(
    `SELECT settled_tier, settled_arm, COUNT(*)::text AS count
     FROM voter_lean_fusion
     WHERE upload_id = $1 AND user_id = $2 AND settled_tier IS NOT NULL
     GROUP BY settled_tier, settled_arm`,
    [uploadId, userId],
  );

  // Waterfall before-state: how many voters flow INTO each tier. A voter blocks
  // later tiers when accepted, or settled cheaper and not re-enrolled. This is an
  // estimate after re-enroll/re-run cycles (arm_runs will record exact pools).
  const flowRes = await client.query<{
    settled_tier: number | null;
    accepted: boolean;
    re_enrolled: boolean;
    count: string;
  }>(
    `SELECT settled_tier,
            (review_status = 'accepted') AS accepted,
            (research_status = 're_enrolled') AS re_enrolled,
            COUNT(*)::text AS count
     FROM voter_lean_fusion
     WHERE upload_id = $1 AND user_id = $2
     GROUP BY 1, 2, 3`,
    [uploadId, userId],
  );

  const reviewRes = await client.query<{ accepted: string; re_enrolled: string }>(
    `SELECT COUNT(*) FILTER (WHERE review_status = 'accepted')::text AS accepted,
            COUNT(*) FILTER (WHERE research_status = 're_enrolled')::text AS re_enrolled
     FROM voter_lean_fusion
     WHERE upload_id = $1 AND user_id = $2`,
    [uploadId, userId],
  );

  // The pool the next arm would claim — mirrors the claim-query predicate
  // (shared constant so this and countEligibleVoters can't drift).
  const eligibleRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM voter_records vr
     WHERE vr.upload_id = $1 AND vr.user_id = $2
       AND ${CLAIM_ELIGIBLE_PREDICATE}`,
    [uploadId, userId],
  );

  const accountRes = await client.query<{ account_id: string | null }>(
    `SELECT account_id FROM voter_uploads WHERE id = $1 AND user_id = $2`,
    [uploadId, userId],
  );
  const accountId = accountRes.rows[0]?.account_id ?? null;

  const billingRes = accountId
    ? await client.query<{ kind: string; total: string }>(
        `SELECT kind, COALESCE(-SUM(amount_usd), 0)::text AS total
         FROM billing_ledger
         WHERE upload_id = $1 AND user_id = $2 AND amount_usd < 0
         GROUP BY kind`,
        [uploadId, userId],
      )
    : null;

  const fecJobRes = await client.query<{
    status: string;
    processed_count: number;
    total_count: number;
    hits_count: number;
    confirmed_hits_count: number;
  }>(
    `SELECT status, processed_count, total_count, hits_count, COALESCE(confirmed_hits_count, 0) AS confirmed_hits_count
     FROM fec_sweep_jobs
     WHERE upload_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [uploadId, userId],
  );

  // Runner executions — arm_runs plus the API sweep normalized into the same
  // shape (adapt-at-read, never dual-write; D-029/D-030 rationale in DECISIONS).
  type RunRow = {
    id: string;
    arm: string;
    runner: string;
    status: string;
    processed_count: number;
    total_count: number;
    failed_count: number;
    hits_count: number;
    confirmed_count: number;
    lean_signal_count: number;
    error_message: string | null;
    started_at: string | null;
    last_heartbeat_at: string | null;
    completed_at: string | null;
  };
  let runRows: RunRow[] = [];
  try {
    const runsRes = await client.query<RunRow>(
      `SELECT * FROM (
         SELECT id::text, arm, runner, status, processed_count, total_count, failed_count,
                hits_count, confirmed_count, lean_signal_count, error_message,
                started_at::text, last_heartbeat_at::text, completed_at::text, created_at
         FROM arm_runs WHERE upload_id = $1 AND user_id = $2
         UNION ALL
         SELECT id::text, 'fec', 'fec_api_sweep', status, processed_count, total_count, failed_count,
                hits_count, COALESCE(confirmed_hits_count, 0), 0, error_message,
                started_at::text, last_heartbeat_at::text, completed_at::text, created_at
         FROM fec_sweep_jobs WHERE upload_id = $1 AND user_id = $2
       ) r
       ORDER BY created_at DESC
       LIMIT 20`,
      [uploadId, userId],
    );
    runRows = runsRes.rows;
  } catch (e) {
    // Pre-migration-014 degradation: no arm_runs table yet → no run feed.
    if (!(e instanceof Error && 'code' in e && (e as { code?: string }).code === '42P01')) {
      throw e;
    }
  }
  const active = runRows.filter((r) => r.status === 'queued' || r.status === 'running');
  const recentByArm = new Map<string, RunRow>();
  for (const r of runRows) {
    if (r.status === 'queued' || r.status === 'running') continue;
    if (!recentByArm.has(r.arm)) recentByArm.set(r.arm, r); // rows are newest-first
  }

  // Researcher labeling opportunity: (eligible voter, committee) pairs from
  // fl_contrib events, filtered live through patterns + current labels — so
  // labeling a committee (or a pattern fix) shrinks the counts without a re-pass.
  const committeePairsRes = await client.query<{ voter_id: string; committee: string }>(
    `SELECT DISTINCT ee.voter_record_id::text AS voter_id, x.committee
     FROM evidence_events ee
     JOIN voter_records vr ON vr.id = ee.voter_record_id
     CROSS JOIN LATERAL jsonb_array_elements_text(ee.payload->'unresolved_committees') AS x(committee)
     WHERE ee.upload_id = $1 AND ee.user_id = $2 AND ee.arm = 'fl_contrib'
       AND ee.payload -> 'unresolved_committees' <> '[]'::jsonb
       AND ${CLAIM_ELIGIBLE_PREDICATE}`,
    [uploadId, userId],
  );
  const researcherLabels = committeePairsRes.rows.length
    ? await loadResearcherCommitteeLabels(client, userId)
    : undefined;
  const unlabeledNames = new Set<string>();
  const votersAffected = new Set<string>();
  for (const row of committeePairsRes.rows) {
    if (!inferLeanFromCommitteeName(row.committee, researcherLabels)) {
      unlabeledNames.add(row.committee);
      votersAffected.add(row.voter_id);
    }
  }

  const arms: UploadEvidenceSummary['arms'] = {};
  for (const row of armRes.rows) {
    arms[row.arm] = {
      event_count: Number(row.event_count),
      probable_match_count: Number(row.probable_match_count),
      lean_signal_count: Number(row.lean_signal_count),
      total_cost_usd: Number(row.total_cost ?? 0),
      voters_touched: Number(row.voters_touched),
      voters_confirmed: Number(row.voters_confirmed),
      voters_with_lean: Number(row.voters_with_lean),
      last_event_at: row.last_event_at,
    };
  }

  const fusion = {
    fused_count: 0,
    provisional_count: 0,
    conflicted_count: 0,
    undetermined_count: 0,
    by_lean: {} as Record<string, number>,
  };

  for (const row of fusionRes.rows) {
    const n = Number(row.count);
    if (row.fusion_status === 'fused') fusion.fused_count += n;
    else if (row.fusion_status === 'provisional') fusion.provisional_count += n;
    else if (row.fusion_status === 'conflicted') fusion.conflicted_count += n;
    else fusion.undetermined_count += n;
    if (row.lean && row.lean !== 'Undetermined') {
      fusion.by_lean[row.lean] = (fusion.by_lean[row.lean] ?? 0) + n;
    }
  }

  const settled = {
    by_tier: {} as Record<string, number>,
    by_arm: {} as Record<string, number>,
    total: 0,
  };
  for (const row of settledRes.rows) {
    const n = Number(row.count);
    const tier = String(row.settled_tier);
    settled.by_tier[tier] = (settled.by_tier[tier] ?? 0) + n;
    if (row.settled_arm) {
      settled.by_arm[row.settled_arm] = (settled.by_arm[row.settled_arm] ?? 0) + n;
    }
    settled.total += n;
  }

  let billing: UploadEvidenceSummary['billing'] = null;
  if (accountId) {
    const byKind = { baseline_usd: 0, tier_usd: 0, attempt_usd: 0 };
    for (const row of billingRes?.rows ?? []) {
      const amt = Number(row.total);
      if (row.kind === 'baseline') byKind.baseline_usd = amt;
      else if (row.kind === 'charge') byKind.tier_usd = amt;
      else if (row.kind === 'attempt') byKind.attempt_usd = amt;
    }
    billing = {
      account_id: accountId,
      ...byKind,
      total_usd: Number(
        (byKind.baseline_usd + byKind.tier_usd + byKind.attempt_usd).toFixed(4),
      ),
    };
  }

  const fecJob = fecJobRes.rows[0];

  const eligible_remaining = Number(eligibleRes.rows[0]?.count ?? 0);
  const voter_count = Number(voterCountRes.rows[0]?.count ?? 0);

  // eligible_by_tier[N] = voters flowing into tier N: everyone minus accepted
  // voters, minus voters settled at a cheaper tier who were not re-enrolled.
  // Groups from flowRes are disjoint, so summing blocked groups is exact.
  const eligible_by_tier: Record<string, number> = {};
  for (const tier of [0, 1, 2, 3]) {
    let blocked = 0;
    for (const row of flowRes.rows) {
      const accepted = row.accepted === true;
      const reEnrolled = row.re_enrolled === true;
      const settledTier = row.settled_tier;
      if (accepted || (settledTier !== null && settledTier < tier && !reEnrolled)) {
        blocked += Number(row.count);
      }
    }
    eligible_by_tier[String(tier)] = Math.max(0, voter_count - blocked);
  }

  const money = (n: number) => Number(n.toFixed(2));
  let projected: UploadEvidenceSummary['waterfall']['projected'] = null;
  if (accountId) {
    const rates = await resolveRates(client, accountId);
    projected = {
      tier1_usd: money(eligible_remaining * rates.tier1),
      tier2_usd: money(eligible_remaining * rates.tier2),
      tier3_usd: money(eligible_remaining * rates.tier3),
      osint_attempts_usd: money(eligible_remaining * rates.osintAttempt),
    };
  }

  return {
    upload_id: uploadId,
    voter_count,
    arms,
    fusion,
    settled,
    review: {
      accepted_count: Number(reviewRes.rows[0]?.accepted ?? 0),
      re_enrolled_count: Number(reviewRes.rows[0]?.re_enrolled ?? 0),
    },
    waterfall: { eligible_remaining, eligible_by_tier, projected },
    billing,
    fec_sweep: fecJob
      ? {
          status: fecJob.status,
          processed_count: fecJob.processed_count,
          total_count: fecJob.total_count,
          raw_hits: fecJob.hits_count,
          confirmed_hits: fecJob.confirmed_hits_count,
        }
      : null,
    runs: {
      active: active.map(toArmRunSummary),
      recent: [...recentByArm.values()].map(toArmRunSummary),
    },
    committees: {
      unlabeled_count: unlabeledNames.size,
      voters_affected: votersAffected.size,
    },
  };
}

function toArmRunSummary(r: {
  id: string;
  arm: string;
  runner: string;
  status: string;
  processed_count: number;
  total_count: number;
  failed_count: number;
  hits_count: number;
  confirmed_count: number;
  lean_signal_count: number;
  error_message: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  completed_at: string | null;
}): ArmRunSummary {
  // Postgres ::text timestamps ("2026-07-05 21:59:00+00") are not ISO — Safari
  // rejects them in new Date(). Normalize server-side where Node parses fine.
  const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
  return {
    id: r.id,
    arm: r.arm,
    runner: r.runner,
    status: r.status,
    processed_count: r.processed_count,
    total_count: r.total_count,
    failed_count: r.failed_count,
    hits_count: r.hits_count,
    confirmed_count: r.confirmed_count,
    lean_signal_count: r.lean_signal_count,
    error_message: r.error_message,
    started_at: iso(r.started_at),
    last_heartbeat_at: iso(r.last_heartbeat_at),
    completed_at: iso(r.completed_at),
  };
}