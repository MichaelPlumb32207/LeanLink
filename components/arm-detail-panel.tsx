'use client';

/**
 * Arm detail panel — the expanded body of a clickable line-score inning
 * (ENH-019 Phase 1). Pure render of a BoxScoreInning + UploadEvidenceSummary
 * the workspace already holds. Scoreboard single-source discipline (D-036): the
 * per-arm funnel numbers live ONLY in the line-score row — this panel never
 * restates them. It shows what the row can't: the explainer, the game log (when
 * an arm was played, one diagnostic NOT on the board — raw candidates before the
 * identity gate), and the arm's actions. No fetches, no polling.
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

/**
 * Game-log line for one finished run — when/how the arm was played, plus the one
 * number NOT on the line score: raw candidates before the identity gate. The
 * board owns the funnel outcomes; this never repeats or renames them (D-036).
 */
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
        <span>walked {nf.format(run.processed_count)} rows</span>
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
      {run.hits_count > 0 && (
        <p className="mt-0.5 opacity-55">
          {nf.format(run.hits_count)} raw candidates before the identity gate
        </p>
      )}
      {run.error_message && <p className="mt-0.5 text-amber-300">⚠ {run.error_message}</p>}
      {run.anomalies?.map((a) => (
        <p key={a} className="mt-0.5 text-amber-300">
          ⚠ {a}
        </p>
      ))}
    </div>
  );
}

function Runs({
  activeRuns,
  recentRuns,
}: {
  activeRuns: ArmRunSummary[];
  recentRuns: ArmRunSummary[];
}) {
  if (activeRuns.length === 0 && recentRuns.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-50">Runs</p>
      {activeRuns.map((r) => (
        <RunStrip key={r.id} run={r} />
      ))}
      {recentRuns.map((r) => (
        <RecentRunLine key={r.id} run={r} />
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
    // Over the cap → CLI hint instead of a button. The cap number tells the whole
    // story; the row already owns the eligible/rows count, so we don't restate it.
    if (eligibleFor(id) > cap && action.cliHint) {
      return (
        <div key={id} className="space-y-1">
          <p className="text-[11px] opacity-70">
            Over the {nf.format(cap)} inline cap — run county-scale from the CLI:
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
    // Optional arms (local_media/civic) have no detail spec — game log only.
    return (
      <div className="border-t border-white/10 bg-black/30 px-4 py-3 text-xs">
        {activeRuns.length === 0 && recentRuns.length === 0 ? (
          <p className="opacity-50">No run detail for this arm.</p>
        ) : (
          <Runs activeRuns={activeRuns} recentRuns={recentRuns} />
        )}
      </div>
    );
  }

  const hasCommitteeAction = spec.actions.some((a) => a.id === 'open-committee-manager');
  const committeeLabel = spec.actions.find((a) => a.id === 'open-committee-manager')?.label;

  return (
    <div className="space-y-3 border-t border-white/10 bg-black/30 px-4 py-3 text-xs">
      <div>
        <p className="font-medium opacity-90">{spec.role}</p>
        <p className="mt-1 opacity-70">{spec.explainer}</p>
      </div>

      <Runs activeRuns={activeRuns} recentRuns={recentRuns} />

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
            {hasCommitteeAction && (
              // Committee counts live once, in the ON BASE strip (D-036) — here
              // we surface only the action, not the numbers.
              <button
                type="button"
                onClick={onOpenCommitteeManager}
                className="rounded-lg border border-violet-300/50 px-3 py-1.5 text-xs hover:opacity-80"
              >
                {committeeLabel}
              </button>
            )}
          </div>
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
