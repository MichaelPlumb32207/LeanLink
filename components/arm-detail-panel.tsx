'use client';

/**
 * Arm detail panel — the expanded body of a clickable line-score inning
 * (ENH-019). Pure render of a BoxScoreInning + UploadEvidenceSummary the
 * workspace already holds. Scoreboard single-source discipline (D-036): the
 * per-arm funnel numbers live ONLY in the line-score row — this panel never
 * restates them. It shows what the row can't: the explainer, the game log, the
 * arm's actions, and (D-038) any identity-enrichment arm nested under this
 * inning — Sunbiz confirms officers and books its leans here, so it renders
 * inside the FL contributions panel, not as its own row. No fetches, no polling.
 */
import { type ReactNode } from 'react';
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
type InningState = BoxScoreInning['state'];
type RenderAction = (action: ArmActionSpec, state: InningState) => ReactNode;

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
        <span className={`font-medium ${completed ? 'text-emerald-200/90' : 'text-amber-200/90'}`}>
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

function Runs({ arm, summary }: { arm: string; summary: UploadEvidenceSummary }) {
  const activeRuns = (summary.runs?.active ?? []).filter((r) => r.arm === arm);
  const recentRuns = (summary.runs?.recent ?? []).filter((r) => r.arm === arm);
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

/**
 * Nested identity-enrichment arm (Sunbiz) inside its host inning's panel (D-038).
 * Since it has no line-score row, THIS is the single home for its numbers, so
 * showing "N officers identified" here is not a duplication.
 */
function EnrichmentSection({
  enrichment,
  summary,
  renderAction,
}: {
  enrichment: BoxScoreInning;
  summary: UploadEvidenceSummary;
  renderAction: RenderAction;
}) {
  const spec = ARM_DETAILS[enrichment.arm];
  const actions = (spec?.actions ?? []).filter((a) => EVIDENCE_ACTION_IDS.has(a.id));
  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-50">
        Identity enrichment · {enrichment.label}
      </p>
      {spec && <p className="opacity-70">{spec.explainer}</p>}
      <p className="opacity-80">
        <span className="text-emerald-300">{nf.format(enrichment.identity_hits)}</span> officers
        identified
        {enrichment.settled_here > 0
          ? ` · ${nf.format(enrichment.settled_here)} settled via entity donations (booked in this inning)`
          : ' · address-corroborated ones bridge to entity donations, which book in this inning'}
        .
      </p>
      <Runs arm={enrichment.arm} summary={summary} />
      {actions.length > 0 && (
        <div className="flex flex-wrap items-start gap-2">
          {actions.map((a) => renderAction(a, enrichment.state))}
        </div>
      )}
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
  const box = buildBoxScore(summary);
  const inning = box.innings.find((i) => i.arm === arm) ?? null;
  // Sunbiz nests under FL contributions (the only host today).
  const enrichments = arm === 'fl_contrib' ? box.enrichments : [];

  const eligibleFor = (id: string) =>
    id === 'match-fec-index' ? summary.voter_count : summary.waterfall.eligible_remaining;

  // `state` drives the complete/re-run framing — the host inning's for its own
  // actions, the enrichment's for the nested ones.
  const renderEvidenceAction: RenderAction = (action, state) => {
    const id = action.id as EvidenceActionId;
    const cap = action.maxEligibleInline ?? Infinity;
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
    const confirmOnComplete = id !== 'match-fec-index'; // fec-index never confirmed pre-refactor
    const run = () => {
      if (confirmOnComplete && state === 'complete' && !confirmLongRerun(action.label)) return;
      void runAction(id);
    };
    return (
      <button
        key={id}
        type="button"
        disabled={busy}
        onClick={run}
        className="rounded-lg border border-emerald-300/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
      >
        {busyAction === id
          ? 'Running…'
          : state === 'complete'
            ? `Complete ✓ · Re-run: ${action.label}`
            : action.label}
      </button>
    );
  };

  if (!spec) {
    // Optional arms (local_media/civic) have no detail spec — game log only.
    const hasRuns =
      (summary.runs?.active ?? []).some((r) => r.arm === arm) ||
      (summary.runs?.recent ?? []).some((r) => r.arm === arm);
    return (
      <div className="border-t border-white/10 bg-black/30 px-4 py-3 text-xs">
        {hasRuns ? <Runs arm={arm} summary={summary} /> : <p className="opacity-50">No run detail for this arm.</p>}
      </div>
    );
  }

  const hasCommitteeAction = spec.actions.some((a) => a.id === 'open-committee-manager');
  const committeeLabel = spec.actions.find((a) => a.id === 'open-committee-manager')?.label;
  const evidenceActions = spec.actions.filter((a) => EVIDENCE_ACTION_IDS.has(a.id));

  return (
    <div className="space-y-3 border-t border-white/10 bg-black/30 px-4 py-3 text-xs">
      <div>
        <p className="font-medium opacity-90">{spec.role}</p>
        <p className="mt-1 opacity-70">{spec.explainer}</p>
      </div>

      <Runs arm={arm} summary={summary} />

      {spec.cliOnly && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-50">
            CLI only (owner-gated)
          </p>
          <CliHint command={fillCli(spec.cliOnly.command, uploadId)} />
          <p className="text-[11px] opacity-60">{spec.cliOnly.note}</p>
        </div>
      )}

      {(evidenceActions.length > 0 || hasCommitteeAction) && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-50">Actions</p>
          <div className="flex flex-wrap items-start gap-2">
            {evidenceActions.map((a) => renderEvidenceAction(a, inning?.state ?? 'not_run'))}
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

      {enrichments.map((e) => (
        <EnrichmentSection key={e.arm} enrichment={e} summary={summary} renderAction={renderEvidenceAction} />
      ))}

      {spec.freshnessNote && (
        <p className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-[11px] opacity-60">
          {spec.freshnessNote}
        </p>
      )}
    </div>
  );
}
