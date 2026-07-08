'use client';

/**
 * Arm detail panel — the expanded body of a clickable line-score inning
 * (ENH-019 Phase 1). Pure render of a BoxScoreInning + UploadEvidenceSummary
 * the workspace already holds: role/explainer (ARM_DETAILS), a funnel sentence,
 * this arm's run history (RunStrip + recent runs), and the actions that belong
 * to the arm (moved here from the old steps-1–5 button list). No fetches, no
 * polling, no summary numbers re-derived off a second path.
 */
import { RunStrip } from '@/components/box-score';
import { buildBoxScore, type BoxScoreInning } from '@/lib/box-score';
import { ARM_DETAILS, fillCli, type ArmActionSpec } from '@/lib/evidence/arm-details';
import type { ArmRunSummary, UploadEvidenceSummary } from '@/lib/evidence/types';
import type { EvidenceActionId } from '@/components/use-evidence-actions';

const nf = new Intl.NumberFormat('en-US');
const CLI_RUNNERS = new Set(['fec_index_cli', 'free_pass_cli']);
const EVIDENCE_ACTION_IDS = new Set<string>([
  'match-fec-index',
  'match-fl-contrib',
  'match-sunbiz-entity',
]);

function CliHint({ command }: { command: string }) {
  return (
    <code className="block w-full overflow-x-auto rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-[11px] text-emerald-100/90">
      {command}
    </code>
  );
}

function RecentRunLine({ run }: { run: ArmRunSummary }) {
  const isCli = CLI_RUNNERS.has(run.runner);
  const completed = run.status === 'completed';
  const started = run.started_at ? new Date(run.started_at).toLocaleDateString() : null;
  const finished = run.completed_at ? new Date(run.completed_at).toLocaleDateString() : null;
  return (
    <div className="text-[11px] opacity-80">
      <span className="flex flex-wrap items-center gap-x-2">
        <span
          className={`font-medium ${completed ? 'text-emerald-200/90' : 'text-amber-200/90'}`}
        >
          {completed ? '✓ completed' : run.status}
        </span>
        <span>
          {nf.format(run.processed_count)}/{nf.format(run.total_count)} processed
        </span>
        <span>
          · {nf.format(run.hits_count)} hits · {nf.format(run.confirmed_count)} confirmed
        </span>
        <span className="rounded border border-white/25 px-1 text-[9px] uppercase tracking-wide opacity-80">
          {isCli ? 'cli' : 'ui'}
        </span>
        {started && (
          <span className="opacity-60">
            {started}
            {finished && finished !== started ? ` → ${finished}` : ''}
          </span>
        )}
      </span>
      {run.error_message && (
        <p className="mt-0.5 text-amber-300">⚠ {run.error_message}</p>
      )}
      {run.anomalies?.map((a) => (
        <p key={a} className="mt-0.5 text-amber-300">
          ⚠ {a}
        </p>
      ))}
    </div>
  );
}

export function ArmDetailPanel({
  arm,
  summary,
  uploadId,
  runAction,
  busyAction,
  busy,
  confirmLongRerun,
  onOpenCommitteeManager,
}: {
  arm: string;
  summary: UploadEvidenceSummary;
  uploadId: string;
  runAction: (action: EvidenceActionId) => void | Promise<void>;
  busyAction: EvidenceActionId | null;
  busy: boolean;
  confirmLongRerun: (label: string) => boolean;
  onOpenCommitteeManager: () => void;
}) {
  const spec = ARM_DETAILS[arm];
  const inning: BoxScoreInning | null =
    buildBoxScore(summary).innings.find((i) => i.arm === arm) ?? null;

  const activeRuns = (summary.runs?.active ?? []).filter((r) => r.arm === arm);
  const recentRuns = (summary.runs?.recent ?? []).filter((r) => r.arm === arm);

  // Eligibility number for the inline vs CLI decision — same source the server
  // guards on: total rows for the FEC index, remaining-eligible for free pass.
  const eligibleFor = (id: string) =>
    id === 'match-fec-index' ? summary.voter_count : summary.waterfall.eligible_remaining;

  const maybeRun = (action: EvidenceActionId, confirmOnComplete: boolean) => {
    if (confirmOnComplete && inning?.state === 'complete' && !confirmLongRerun(action)) return;
    void runAction(action);
  };

  const renderEvidenceAction = (action: ArmActionSpec) => {
    const id = action.id as EvidenceActionId;
    const cap = action.maxEligibleInline ?? Infinity;
    const eligible = eligibleFor(id);
    if (eligible > cap && action.cliHint) {
      // FEC re-scores every row, so it's "rows in scope", not "awaiting settlement";
      // the free-pass arms skip settled voters, so their number really is eligible-remaining.
      const noun = id === 'match-fec-index' ? 'rows' : 'eligible';
      return (
        <div key={id} className="space-y-1">
          <p className="text-[11px] opacity-70">
            {nf.format(eligible)} {noun} — over the {nf.format(cap)} inline cap; run county-scale
            from the CLI:
          </p>
          <CliHint command={fillCli(action.cliHint, uploadId)} />
        </div>
      );
    }
    // match-fec-index never confirmed on re-run pre-refactor; free-pass arms did.
    const confirmOnComplete = id !== 'match-fec-index';
    return (
      <button
        key={id}
        type="button"
        disabled={busy}
        onClick={() => maybeRun(id, confirmOnComplete)}
        className="rounded-lg border border-emerald-300/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
      >
        {busyAction === id
          ? 'Running…'
          : inning?.state === 'complete'
            ? `Complete ✓ · Re-run: ${action.label}`
            : action.label}
      </button>
    );
  };

  if (!spec) {
    // Optional arms (local_media/civic) have no detail spec — show the funnel only.
    return (
      <div className="border-t border-white/10 bg-black/30 px-4 py-3 text-xs">
        <FunnelLine inning={inning} hitOnly={false} />
        {activeRuns.map((r) => (
          <RunStrip key={r.id} run={r} />
        ))}
        {recentRuns.map((r) => (
          <RecentRunLine key={r.id} run={r} />
        ))}
      </div>
    );
  }

  const committees = summary.committees;

  return (
    <div className="space-y-3 border-t border-white/10 bg-black/30 px-4 py-3 text-xs">
      <div>
        <p className="font-medium opacity-90">{spec.role}</p>
        <p className="mt-1 opacity-70">{spec.explainer}</p>
      </div>

      <FunnelLine inning={inning} hitOnly={!!spec.hitOnly} />

      {(activeRuns.length > 0 || recentRuns.length > 0) && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-50">Runs</p>
          {activeRuns.map((r) => (
            <RunStrip key={r.id} run={r} />
          ))}
          {recentRuns.map((r) => (
            <RecentRunLine key={r.id} run={r} />
          ))}
        </div>
      )}

      {spec.cliOnly && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-50">
            CLI only (owner-gated)
          </p>
          <CliHint command={fillCli(spec.cliOnly.command, uploadId)} />
          <p className="text-[11px] opacity-60">{spec.cliOnly.note}</p>
        </div>
      )}

      {spec.actions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-50">Actions</p>
          <div className="flex flex-wrap items-start gap-2">
            {spec.actions
              .filter((a) => EVIDENCE_ACTION_IDS.has(a.id))
              .map(renderEvidenceAction)}
            {spec.actions.some((a) => a.id === 'open-committee-manager') && (
              <button
                type="button"
                onClick={onOpenCommitteeManager}
                className="rounded-lg border border-violet-300/50 px-3 py-1.5 text-xs hover:opacity-80"
              >
                {spec.actions.find((a) => a.id === 'open-committee-manager')!.label}
                {(committees?.unlabeled_count ?? 0) > 0 &&
                  ` (${nf.format(committees.unlabeled_count)})`}
              </button>
            )}
          </div>
          {arm === 'fl_contrib' && (committees?.pending_refusion_voters ?? 0) > 0 && (
            <p className="text-[11px] text-violet-200/80">
              {nf.format(committees.pending_refusion_voters)} voters sit behind labeled committees
              awaiting re-fusion — open the manager to book them.
            </p>
          )}
        </div>
      )}

      {spec.freshnessNote && (
        <p className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-[11px] opacity-60">
          {spec.freshnessNote}
        </p>
      )}
    </div>
  );
}

function FunnelLine({
  inning,
  hitOnly,
}: {
  inning: BoxScoreInning | null;
  hitOnly: boolean;
}) {
  if (!inning || inning.state === 'not_run') {
    return <p className="opacity-60">Not run yet on this upload.</p>;
  }
  return (
    <p className="opacity-80">
      <span className="opacity-60">Funnel: </span>
      {nf.format(inning.eligible_in)} eligible → {nf.format(inning.attempted)} processed →{' '}
      {nf.format(inning.identity_hits)} identified → {nf.format(inning.lean_signals)} lean signals →{' '}
      <span className="text-emerald-300">{nf.format(inning.settled_here)} settled here</span>.
      {hitOnly && (
        <span className="opacity-60">
          {' '}
          Hit-only arm — a low event count relative to the eligible pool is expected, not a
          failure.
        </span>
      )}
    </p>
  );
}
