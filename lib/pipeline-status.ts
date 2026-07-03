import type { UploadEvidenceSummary } from '@/lib/evidence/types';

export type PipelineStepId = 1 | 2 | 3 | 4 | 5;

export type PipelineStepState = 'complete' | 'ready' | 'running' | 'locked' | 'optional';

export interface PipelineStepStatus {
  id: PipelineStepId;
  title: string;
  state: PipelineStepState;
  detail: string;
}

export interface PipelineScoreboard {
  npas_in_file: number;
  labeled_count: number;
  undetermined_count: number;
  labeled_pct: number;
  by_lean: Record<string, number>;
  arm_lean_yield: { arm: string; label: string; events: number; lean_signals: number }[];
  settled_by_tier: Record<string, number>;
  settled_total: number;
  billing: {
    total_usd: number;
    baseline_usd: number;
    tier_usd: number;
    attempt_usd: number;
  } | null;
}

export function buildPipelineScoreboard(summary: UploadEvidenceSummary): PipelineScoreboard {
  const labeled_count = summary.fusion.fused_count + summary.fusion.provisional_count;
  const npas = summary.voter_count;
  const undetermined = Math.max(
    0,
    summary.fusion.undetermined_count + summary.fusion.conflicted_count,
  );

  const armLabels: Record<string, string> = {
    fec: 'FEC federal',
    fl_contrib: 'FL contributors',
    sunbiz: 'Sunbiz officers',
    household: 'Household',
    human_judgment: 'Researcher',
    osint: 'OSINT',
  };

  const arm_lean_yield = Object.entries(summary.arms)
    .map(([arm, stats]) => ({
      arm,
      label: armLabels[arm] ?? arm,
      events: stats.event_count,
      lean_signals: stats.lean_signal_count,
    }))
    .filter((a) => a.events > 0)
    .sort((a, b) => b.lean_signals - a.lean_signals || b.events - a.events);

  return {
    npas_in_file: npas,
    labeled_count,
    undetermined_count: undetermined > 0 ? undetermined : Math.max(0, npas - labeled_count),
    labeled_pct: npas > 0 ? Math.round((labeled_count / npas) * 1000) / 10 : 0,
    by_lean: summary.fusion.by_lean,
    arm_lean_yield,
    settled_by_tier: summary.settled.by_tier,
    settled_total: summary.settled.total,
    billing: summary.billing
      ? {
          total_usd: summary.billing.total_usd,
          baseline_usd: summary.billing.baseline_usd,
          tier_usd: summary.billing.tier_usd,
          attempt_usd: summary.billing.attempt_usd,
        }
      : null,
  };
}

export function buildPipelineSteps(
  summary: UploadEvidenceSummary,
  opts?: { fec_running?: boolean; tier0_running?: boolean },
): PipelineStepStatus[] {
  const npas = summary.voter_count;
  const fecJob = summary.fec_sweep;
  const fecImported = (summary.arms.fec?.event_count ?? 0) > 0;
  const flDone = (summary.arms.fl_contrib?.event_count ?? 0) >= npas * 0.5;
  const sunbizDone = (summary.arms.sunbiz?.event_count ?? 0) >= npas * 0.5;

  const fecComplete = fecJob?.status === 'completed';
  const fecRunning = opts?.fec_running || fecJob?.status === 'running' || fecJob?.status === 'queued';

  let step3: PipelineStepState = 'ready';
  if (fecRunning) step3 = 'running';
  else if (fecImported) step3 = 'complete';
  else if (fecComplete) step3 = 'ready';
  else if (!fecJob) step3 = 'ready';

  let step4: PipelineStepState = 'locked';
  if (flDone) step4 = 'complete';
  else if (opts?.tier0_running) step4 = 'running';
  else if (fecImported || !fecJob) step4 = 'ready';

  let step5: PipelineStepState = 'locked';
  if (sunbizDone) step5 = 'complete';
  else if (opts?.tier0_running) step5 = 'running';
  else if (flDone) step5 = 'ready';

  return [
    {
      id: 1,
      title: 'Upload file',
      state: 'complete',
      detail: 'Registration extract ingested',
    },
    {
      id: 2,
      title: 'Extract NPAs',
      state: npas > 0 ? 'complete' : 'locked',
      detail: npas > 0 ? `${npas} NPA + Active voters` : 'Waiting on upload',
    },
    {
      id: 3,
      title: 'FEC federal match',
      state: step3,
      detail: fecImported
        ? `${summary.arms.fec?.lean_signal_count ?? 0} lean from FEC`
        : fecComplete
          ? `${fecJob?.confirmed_hits ?? 0} confirmed — import to ledger`
          : fecRunning
            ? `${fecJob?.processed_count ?? 0}/${npas} checked`
            : 'Not started',
    },
    {
      id: 4,
      title: 'FL contributors (person)',
      state: step4,
      detail: flDone
        ? `${summary.arms.fl_contrib?.lean_signal_count ?? 0} lean signals`
        : 'Match person-name FL DOS contributions',
    },
    {
      id: 5,
      title: 'Sunbiz → FL entity',
      state: step5,
      detail: sunbizDone
        ? `${summary.arms.sunbiz?.event_count ?? 0} officer · ${summary.arms.fl_contrib?.event_count ?? 0} entity events`
        : 'Officer match + entity FL contributions',
    },
  ];
}

export function suggestNextStep(steps: PipelineStepStatus[]): PipelineStepId | null {
  for (const id of [3, 4, 5] as PipelineStepId[]) {
    const step = steps.find((s) => s.id === id);
    if (step?.state === 'running') return null;
    if (step?.state === 'ready') return id;
  }
  return null;
}

export function confirmLongRerun(stepTitle: string): boolean {
  return window.confirm(
    `${stepTitle} already ran on this upload.\n\nRe-running can take a long time and will refresh evidence for all voters.\n\nContinue?`,
  );
}