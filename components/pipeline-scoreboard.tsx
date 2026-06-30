'use client';

import type { PipelineScoreboard } from '@/lib/pipeline-status';
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

export function PipelineScoreboardPanel({ score }: { score: PipelineScoreboard }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide opacity-60 mb-2">
        Lean score (cumulative)
      </h4>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{score.npas_in_file}</div>
          <div className="text-[10px] uppercase tracking-wide opacity-60">NPAs in file</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums text-emerald-300">
            {score.labeled_count}
          </div>
          <div className="text-[10px] uppercase tracking-wide opacity-60">Labeled now</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{score.undetermined_count}</div>
          <div className="text-[10px] uppercase tracking-wide opacity-60">Still undetermined</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{score.labeled_pct}%</div>
          <div className="text-[10px] uppercase tracking-wide opacity-60">Coverage</div>
        </div>
      </div>
      {Object.keys(score.by_lean).length > 0 && (
        <p className="mt-2 text-xs opacity-75">
          By lean:{' '}
          {Object.entries(score.by_lean)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')}
        </p>
      )}
      {score.arm_lean_yield.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wide opacity-60 mb-1">Arm yield (lean signals)</p>
          <ul className="space-y-0.5 text-xs opacity-85">
            {score.arm_lean_yield.map((a) => (
              <li key={a.arm} className="flex justify-between gap-2">
                <span>{a.label}</span>
                <span className="tabular-nums shrink-0">
                  {a.lean_signals} lean · {a.events} events
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}