import { fuseEvidenceEvents } from '@/lib/evidence/fusion';
import { computeSettlement } from '@/lib/evidence/settlement';
import { getUploadAccountId, chargeSettlement } from '@/lib/billing/ledger';
import { resolveRates, tierRate } from '@/lib/billing/rates';
import type {
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
  }>(
    `SELECT arm,
            COUNT(*)::text AS event_count,
            COUNT(*) FILTER (WHERE probable_same_person)::text AS probable_match_count,
            COUNT(*) FILTER (WHERE lean_signal IS NOT NULL AND lean_signal != 'Undetermined')::text AS lean_signal_count,
            SUM(cost_usd)::text AS total_cost
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

  const settledRes = await client.query<{ settled_tier: number; count: string }>(
    `SELECT settled_tier, COUNT(*)::text AS count
     FROM voter_lean_fusion
     WHERE upload_id = $1 AND user_id = $2 AND settled_tier IS NOT NULL
     GROUP BY settled_tier`,
    [uploadId, userId],
  );

  const reviewRes = await client.query<{ accepted: string; re_enrolled: string }>(
    `SELECT COUNT(*) FILTER (WHERE review_status = 'accepted')::text AS accepted,
            COUNT(*) FILTER (WHERE research_status = 're_enrolled')::text AS re_enrolled
     FROM voter_lean_fusion
     WHERE upload_id = $1 AND user_id = $2`,
    [uploadId, userId],
  );

  // The pool the next arm would claim — mirrors the claim-query predicate.
  const eligibleRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM voter_records vr
     WHERE vr.upload_id = $1 AND vr.user_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM voter_lean_fusion vlf
         WHERE vlf.voter_record_id = vr.id
           AND (vlf.review_status = 'accepted'
                OR (vlf.settled_tier IS NOT NULL
                    AND vlf.research_status IS DISTINCT FROM 're_enrolled'))
       )`,
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
    hits_count: number;
    confirmed_hits_count: number;
  }>(
    `SELECT status, processed_count, hits_count, COALESCE(confirmed_hits_count, 0) AS confirmed_hits_count
     FROM fec_sweep_jobs
     WHERE upload_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [uploadId, userId],
  );

  const arms: UploadEvidenceSummary['arms'] = {};
  for (const row of armRes.rows) {
    arms[row.arm] = {
      event_count: Number(row.event_count),
      probable_match_count: Number(row.probable_match_count),
      lean_signal_count: Number(row.lean_signal_count),
      total_cost_usd: Number(row.total_cost ?? 0),
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

  const settled = { by_tier: {} as Record<string, number>, total: 0 };
  for (const row of settledRes.rows) {
    const n = Number(row.count);
    settled.by_tier[String(row.settled_tier)] = n;
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
    voter_count: Number(voterCountRes.rows[0]?.count ?? 0),
    arms,
    fusion,
    settled,
    review: {
      accepted_count: Number(reviewRes.rows[0]?.accepted ?? 0),
      re_enrolled_count: Number(reviewRes.rows[0]?.re_enrolled ?? 0),
    },
    waterfall: { eligible_remaining, projected },
    billing,
    fec_sweep: fecJob
      ? {
          status: fecJob.status,
          processed_count: fecJob.processed_count,
          raw_hits: fecJob.hits_count,
          confirmed_hits: fecJob.confirmed_hits_count,
        }
      : null,
  };
}