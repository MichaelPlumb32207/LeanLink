import type { LeanLabel } from '@/lib/enrichment/types';
import type { EvidenceArmId, EvidenceEventRow, FusionResult, FusionStatus } from '@/lib/evidence/types';

const LEAN_WEIGHT: Record<LeanLabel, number> = {
  Left: 0,
  Right: 0,
  Independent: 0,
  Undetermined: 0,
};

function armWeight(arm: EvidenceArmId, identityBand: string | null): number {
  let w = 1;
  if (arm === 'fec') w = 1.25;
  if (arm === 'osint') w = 1;
  if (arm === 'local_media' || arm === 'civic') w = 1.1;
  if (arm === 'household') w = 0.55;
  if (identityBand === 'confirmed') w *= 1.2;
  else if (identityBand === 'probable') w *= 1;
  else if (identityBand === 'ambiguous') w *= 0.35;
  else w *= 0;
  return w;
}

/**
 * Fuse accumulated evidence events into a single lean label + confidence.
 */
export function fuseEvidenceEvents(events: EvidenceEventRow[]): FusionResult {
  const leanScores: Record<LeanLabel, number> = { ...LEAN_WEIGHT };
  const contributing_arms = new Set<EvidenceArmId>();
  const evidence_summary: string[] = [];
  let event_count = 0;

  for (const event of events) {
    event_count += 1;
    if (!event.probable_same_person && event.arm !== 'turnout') continue;

    const weight = armWeight(event.arm, event.identity_band);
    if (weight <= 0) continue;

    if (event.lean_signal && event.lean_signal !== 'Undetermined' && event.lean_confidence) {
      const score = weight * event.lean_confidence;
      leanScores[event.lean_signal] += score;
      contributing_arms.add(event.arm);
      const headline = event.evidence[0] ?? `${event.arm} signal`;
      if (!evidence_summary.includes(headline)) evidence_summary.push(headline);
    }
  }

  const ranked = (Object.entries(leanScores) as [LeanLabel, number][])
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    return {
      lean: 'Undetermined',
      confidence: 0,
      fusion_status: 'undetermined',
      contributing_arms: [],
      evidence_summary: events
        .filter((e) => e.evidence.length)
        .flatMap((e) => e.evidence)
        .slice(0, 5),
      event_count,
    };
  }

  const [topLean, topScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;

  let fusion_status: FusionStatus = 'fused';
  let confidence = Math.min(95, Math.round(topScore / Math.max(contributing_arms.size, 1)));

  if (secondScore > 0 && topScore / secondScore < 1.4) {
    fusion_status = 'conflicted';
    return {
      lean: 'Undetermined',
      confidence: Math.min(40, confidence),
      fusion_status,
      contributing_arms: [...contributing_arms],
      evidence_summary: [
        ...evidence_summary,
        'Conflicting lean signals across evidence arms — label withheld.',
      ],
      event_count,
    };
  }

  if (contributing_arms.size === 1 && ranked[0][1] < 50) {
    fusion_status = 'provisional';
    confidence = Math.min(confidence, 65);
  }

  if (topLean === 'Independent') {
    confidence = Math.min(confidence, 60);
  }

  return {
    lean: topLean,
    confidence,
    fusion_status,
    contributing_arms: [...contributing_arms],
    evidence_summary,
    event_count,
  };
}