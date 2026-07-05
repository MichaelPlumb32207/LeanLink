import type { UploadEvidenceSummary } from '@/lib/evidence/types';

export type PipelineStepId = 1 | 2 | 3 | 4 | 5;

export type PipelineStepState = 'complete' | 'ready' | 'running' | 'locked' | 'optional';

export interface PipelineStepStatus {
  id: PipelineStepId;
  title: string;
  state: PipelineStepState;
  detail: string;
}

// The cumulative scoreboard moved to lib/box-score.ts (buildBoxScore) — the
// pinned box score + line score are the single rendering of those numbers.

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