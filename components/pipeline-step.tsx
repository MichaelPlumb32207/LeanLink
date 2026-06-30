import type { ReactNode } from 'react';

/** Plain step digit — no circled unicode (①②③ are hard to read on dark UI). */
export function PipelineStepNumber({ step }: { step: number }) {
  return (
    <span
      className="inline-flex min-w-[1.35rem] shrink-0 items-center justify-center text-lg font-bold tabular-nums leading-none text-emerald-200"
      aria-hidden
    >
      {step}
    </span>
  );
}

export function PipelineStepRow({
  step,
  children,
}: {
  step: number;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <PipelineStepNumber step={step} />
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </div>
  );
}

export function PipelineStepButtonLabel({
  step,
  label,
}: {
  step: number;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <PipelineStepNumber step={step} />
      <span>{label}</span>
    </span>
  );
}