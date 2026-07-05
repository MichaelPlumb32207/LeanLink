'use client';

/**
 * The box score — pinned engagement scoreboard (BoxScoreBar), per-arm line
 * score (LineScore), and live current-inning detail. Read-only surfaces: all
 * numbers come from UploadEvidenceSummary via buildBoxScore; actions stay with
 * the pipeline controls in the evidence workspace.
 */
import { buildBoxScore, type BoxScoreInning } from '@/lib/box-score';
import type { ArmRunSummary, UploadEvidenceSummary } from '@/lib/evidence/types';

const nf = new Intl.NumberFormat('en-US');

const RUN_ARM_LABELS: Record<string, string> = {
  fec: 'FEC',
  fl_contrib: 'FL contrib',
  sunbiz: 'Sunbiz',
  osint: 'OSINT',
};

const CLI_RUNNERS = new Set(['fec_index_cli', 'free_pass_cli']);
const STALLED_MS = 5 * 60 * 1000;

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
  const activeRuns = summary.runs?.active ?? [];

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
        {activeRuns.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-1.5">
            {activeRuns.map((run) => (
              <span
                key={run.id}
                className="inline-flex items-center gap-2 rounded-full border border-sky-400/50 bg-sky-500/15 px-3 py-1 text-xs text-sky-100"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-sky-300" />
                {RUN_ARM_LABELS[run.arm] ?? run.arm} {nf.format(run.processed_count)}/
                {nf.format(run.total_count)}
              </span>
            ))}
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
      {activeRuns.length > 0 && <CurrentInning runs={activeRuns} />}
    </div>
  );
}

/** Live detail for every running arm — fed by arm_runs (∪ fec_sweep_jobs),
 *  so CLI-started county runs show up here too. */
export function CurrentInning({ runs }: { runs: ArmRunSummary[] }) {
  return (
    <div className="mt-2 space-y-2">
      {runs.map((run) => (
        <RunStrip key={run.id} run={run} />
      ))}
    </div>
  );
}

function RunStrip({ run }: { run: ArmRunSummary }) {
  const total = run.total_count;
  const pct = total > 0 ? Math.max(2, Math.round((run.processed_count / total) * 100)) : 2;

  const startedMs = run.started_at ? Date.parse(run.started_at) : NaN;
  const elapsedS = Number.isFinite(startedMs) ? Math.max(1, (Date.now() - startedMs) / 1000) : null;
  const rate = elapsedS ? run.processed_count / elapsedS : null;
  const etaMin =
    rate && rate > 0 && total > run.processed_count
      ? (total - run.processed_count) / rate / 60
      : null;

  const heartbeatMs = run.last_heartbeat_at ? Date.parse(run.last_heartbeat_at) : NaN;
  const heartbeatAgeS = Number.isFinite(heartbeatMs)
    ? Math.max(0, Math.round((Date.now() - heartbeatMs) / 1000))
    : null;
  const stalled = heartbeatAgeS != null && heartbeatAgeS * 1000 > STALLED_MS;

  const etaLabel =
    etaMin == null ? null : etaMin >= 90 ? `ETA ${(etaMin / 60).toFixed(1)} h` : `ETA ${Math.max(1, Math.round(etaMin))} min`;

  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-black/30">
        <div
          className={`h-full rounded-full transition-all duration-500 ${stalled ? 'bg-amber-400/70' : 'bg-sky-400/70'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] opacity-80">
        <span className="font-medium">{RUN_ARM_LABELS[run.arm] ?? run.arm}</span>
        {CLI_RUNNERS.has(run.runner) && (
          <span className="rounded border border-white/25 px-1 text-[9px] uppercase tracking-wide opacity-80">
            CLI
          </span>
        )}
        <span>
          {nf.format(run.processed_count)}/{nf.format(total)} ({pct}%)
        </span>
        {rate != null && <span>· {rate >= 10 ? Math.round(rate) : rate.toFixed(1)}/s</span>}
        {etaLabel && <span>· {etaLabel}</span>}
        <span>
          · {nf.format(run.hits_count)} hits · {nf.format(run.confirmed_count)} confirmed ·{' '}
          {nf.format(run.lean_signal_count)} leans
        </span>
        {heartbeatAgeS != null && (
          <span className={stalled ? 'font-medium text-amber-300' : 'opacity-60'}>
            · {stalled ? `no heartbeat for ${Math.round(heartbeatAgeS / 60)} min — stalled?` : `heartbeat ${heartbeatAgeS}s ago`}
          </span>
        )}
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
