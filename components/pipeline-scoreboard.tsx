'use client';

import type { PipelineStepStatus } from '@/lib/pipeline-status';

const STATE_STYLES: Record<PipelineStepStatus['state'], string> = {
  complete: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-100',
  ready: 'border-amber-400/50 bg-amber-500/10 text-amber-100',
  running: 'border-sky-400/50 bg-sky-500/15 text-sky-100',
  locked: 'border-white/10 bg-black/20 opacity-50',
  optional: 'border-white/15 bg-black/15 opacity-75',
};

export function PipelineFlowTrack({
  steps,
  suggestedStep,
}: {
  steps: PipelineStepStatus[];
  suggestedStep?: number | null;
}) {
  return (
    <ol className="grid gap-2 sm:grid-cols-5">
      {steps.map((step) => (
        <li
          key={step.id}
          className={`rounded-lg border px-2.5 py-2 text-xs ${STATE_STYLES[step.state]} ${
            suggestedStep === step.id ? 'ring-1 ring-amber-400/60' : ''
          }`}
        >
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold tabular-nums leading-none">{step.id}</span>
            <span className="font-medium leading-tight">{step.title}</span>
          </div>
          <p className="mt-1 text-[10px] opacity-80 leading-snug">{step.detail}</p>
          <p className="mt-1 text-[10px] uppercase tracking-wide opacity-60">{step.state}</p>
        </li>
      ))}
    </ol>
  );
}

// PipelineScoreboardPanel was absorbed by the pinned box score (components/box-score.tsx).