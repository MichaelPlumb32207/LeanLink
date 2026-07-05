'use client';

/**
 * The box score — pinned engagement scoreboard (BoxScoreBar), per-arm line
 * score (LineScore), and live current-inning detail. Read-only surfaces: all
 * numbers come from UploadEvidenceSummary via buildBoxScore; actions stay with
 * the pipeline controls in the evidence workspace.
 */
import { buildBoxScore, type BoxScoreInning } from '@/lib/box-score';
import type { UploadEvidenceSummary } from '@/lib/evidence/types';

const nf = new Intl.NumberFormat('en-US');

const INNING_STATE_STYLES: Record<BoxScoreInning['state'], string> = {
  live: 'border-sky-400/50 bg-sky-500/15 text-sky-100',
  run: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-100',
  partial: 'border-amber-400/50 bg-amber-500/10 text-amber-100',
  not_run: 'border-white/15 bg-black/20 opacity-60',
};

const INNING_STATE_LABELS: Record<BoxScoreInning['state'], string> = {
  live: 'live',
  run: 'run',
  partial: 'partial',
  not_run: 'not run',
};

function StatCell({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: string;
}) {
  return (
    <div className="min-w-[5.5rem] rounded-lg bg-black/25 px-3 py-1.5 text-center">
      <div className={`text-xl font-semibold tabular-nums leading-tight ${tone ?? ''}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide opacity-60">{label}</div>
    </div>
  );
}

export function BoxScoreBar({
  summary,
  lastUpdated,
}: {
  summary: UploadEvidenceSummary;
  lastUpdated: Date | null;
}) {
  const { scoreboard } = buildBoxScore(summary);
  const sweep = summary.fec_sweep;
  const sweepLive = sweep?.status === 'running' || sweep?.status === 'queued';

  const byLean = Object.entries(scoreboard.by_lean)
    .map(([k, v]) => `${k} ${nf.format(v)}`)
    .join(' · ');

  return (
    <div className="scorebar sticky top-0 z-30 rounded-xl px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatCell value={nf.format(scoreboard.records_in)} label="Records in" />
        <StatCell
          value={nf.format(scoreboard.leans_settled)}
          label="Leans settled"
          tone="text-emerald-300"
        />
        <StatCell
          value={nf.format(scoreboard.conflicted)}
          label="Conflicted"
          tone={scoreboard.conflicted > 0 ? 'text-amber-300' : undefined}
        />
        <StatCell value={nf.format(scoreboard.accepted)} label="Accepted" />
        <StatCell
          value={nf.format(scoreboard.eligible_remaining)}
          label="Still in research"
        />
        {sweepLive && sweep && (
          <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-sky-400/50 bg-sky-500/15 px-3 py-1 text-xs text-sky-100">
            <span className="h-2 w-2 animate-pulse rounded-full bg-sky-300" />
            FEC {nf.format(sweep.processed_count)}/
            {nf.format(sweep.total_count || summary.voter_count)}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs opacity-70">
        {scoreboard.labeled_count > 0 && (
          <>
            Labeled {nf.format(scoreboard.labeled_count)} ({scoreboard.labeled_pct}%)
            {byLean ? ` — ${byLean}` : ''}
          </>
        )}
        {scoreboard.billing_total_usd !== null && (
          <> · Billed ${scoreboard.billing_total_usd.toFixed(2)}</>
        )}
        {lastUpdated && (
          <span className="opacity-60"> · updated {lastUpdated.toLocaleTimeString()}</span>
        )}
      </p>
      {sweepLive && sweep && <CurrentInning summary={summary} />}
    </div>
  );
}

/** Live detail for the running arm — Phase A covers the FEC API sweep;
 *  arm_runs (migration 014) generalizes this to every runner. */
export function CurrentInning({ summary }: { summary: UploadEvidenceSummary }) {
  const sweep = summary.fec_sweep;
  if (!sweep || (sweep.status !== 'running' && sweep.status !== 'queued')) return null;
  const total = sweep.total_count || summary.voter_count;
  const pct = total > 0 ? Math.max(2, Math.round((sweep.processed_count / total) * 100)) : 2;
  return (
    <div className="mt-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-black/30">
        <div
          className="h-full rounded-full bg-sky-400/70 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] opacity-70">
        FEC federal sweep · {sweep.status} · {nf.format(sweep.processed_count)}/
        {nf.format(total)} checked · {nf.format(sweep.raw_hits)} raw ·{' '}
        {nf.format(sweep.confirmed_hits)} confirmed
      </p>
    </div>
  );
}

export function LineScore({ summary }: { summary: UploadEvidenceSummary }) {
  const { innings, supporting } = buildBoxScore(summary);
  const dash = <span className="opacity-40">—</span>;
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide opacity-60">
        Line score — arm by arm
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide opacity-60">
              <th className="py-1 pr-2 font-medium">Tier</th>
              <th className="py-1 pr-2 font-medium">Arm</th>
              <th className="py-1 pr-2 text-right font-medium">In (est.)</th>
              <th className="py-1 pr-2 text-right font-medium">Processed</th>
              <th className="py-1 pr-2 text-right font-medium">ID hits</th>
              <th className="py-1 pr-2 text-right font-medium">Lean signals</th>
              <th className="py-1 pr-2 text-right font-medium">Settled here</th>
              <th className="py-1 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {innings.map((inning) => (
              <tr key={inning.arm} className="border-t border-white/10">
                <td className="py-1.5 pr-2 tabular-nums opacity-70">T{inning.tier}</td>
                <td className="py-1.5 pr-2 font-medium">{inning.label}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {nf.format(inning.eligible_in)}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {inning.state === 'not_run' ? dash : nf.format(inning.attempted)}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {inning.state === 'not_run' ? dash : nf.format(inning.identity_hits)}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {inning.state === 'not_run' ? dash : nf.format(inning.lean_signals)}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-emerald-300">
                  {inning.state === 'not_run' && inning.settled_here === 0
                    ? dash
                    : nf.format(inning.settled_here)}
                </td>
                <td className="py-1.5">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${INNING_STATE_STYLES[inning.state]}`}
                  >
                    {INNING_STATE_LABELS[inning.state]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {supporting.length > 0 && (
        <p className="mt-2 text-[11px] opacity-60">
          Supporting arms:{' '}
          {supporting
            .map((s) =>
              s.lean_signals > 0
                ? `${s.label} ${nf.format(s.events)} events (${nf.format(s.lean_signals)} lean)`
                : `${s.label} ${nf.format(s.events)} events`,
            )
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
