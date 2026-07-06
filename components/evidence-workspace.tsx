'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CommitteeLeanManager } from '@/components/committee-lean-manager';
import { CommitteeQuickLabel } from '@/components/committee-quick-label';
import { FecSweepPanel } from '@/components/fec-sweep-panel';
import { PipelineStepButtonLabel, PipelineStepRow } from '@/components/pipeline-step';
import { LineScore } from '@/components/box-score';
import { PipelineFlowTrack } from '@/components/pipeline-scoreboard';
import { ResidenceTiebreaker } from '@/components/residence-tiebreaker';
import { ballotFavorsLabel } from '@/lib/ballot-favors';
import type { UploadEvidenceSummary } from '@/lib/evidence/types';
import {
  buildPipelineSteps,
  confirmLongRerun,
  suggestNextStep,
  type PipelineStepState,
} from '@/lib/pipeline-status';

type VoterListRow = {
  id: string;
  row_index: number;
  raw_data: {
    name: { full: string };
    residence: { city: string; zip: string; line1: string; full: string };
    party: string;
    precinct: string;
  };
  lean: string | null;
  confidence: number | null;
  fusion_status: string | null;
  contributing_arms: string[] | null;
  review_status: string | null;
  research_status: string | null;
  settled_tier: number | null;
  event_count: number;
  fec_confirmed: boolean | null;
  has_sunbiz: boolean | null;
  has_fl_contrib: boolean | null;
  has_layer2: boolean | null;
};

type VoterArmFilter = 'fec' | 'fl_contrib' | 'layer2' | 'sunbiz';

type EvidenceEvent = {
  id: string;
  arm: string;
  source: string;
  identity_band: string | null;
  identity_score: number | null;
  probable_same_person: boolean;
  lean_signal: string | null;
  lean_confidence: number | null;
  evidence: string[];
  urls: string[];
  created_at: string;
  payload: {
    unresolved_committees?: string[];
    committees?: string[];
  } | null;
};

type VoterDetail = {
  voter: { id: string; row_index: number; raw_data: VoterListRow['raw_data'] };
  events: EvidenceEvent[];
  fusion: {
    lean: string;
    confidence: number;
    fusion_status: string;
    contributing_arms: string[];
    evidence_summary: string[];
  };
  fusion_persisted: {
    lean: string | null;
    confidence: number | null;
    fusion_status: string | null;
    review_status: string | null;
    research_status: string | null;
    settled_arm: string | null;
    settled_tier: number | null;
  } | null;
};

type EvidenceUploadMeta = {
  filename: string;
  row_count: number;
  ballot_favors?: string | null;
};

type Tier0Action = 'match-fl-contrib' | 'match-sunbiz-entity' | 'match-tier0-all' | 'match-fec-index';

export function EvidenceWorkspace({
  uploadId,
  upload,
  summary,
  refreshSummary,
}: {
  uploadId: string;
  upload?: EvidenceUploadMeta | null;
  /** Owned by the page-level useEvidenceSummary hook (single polling loop). */
  summary: UploadEvidenceSummary | null;
  refreshSummary: () => Promise<void>;
}) {
  const [voters, setVoters] = useState<VoterListRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VoterDetail | null>(null);
  const [nameFilter, setNameFilter] = useState('');
  const [armFilters, setArmFilters] = useState<Set<VoterArmFilter>>(new Set());
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingAction, setSyncingAction] = useState<Tier0Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committeeManagerOpen, setCommitteeManagerOpen] = useState(false);

  const refreshVoters = useCallback(async () => {
    const params = new URLSearchParams({ list: '1', limit: '1000' });
    if (nameFilter.trim()) params.set('name', nameFilter.trim());
    if (armFilters.has('fec')) params.set('fec', '1');
    if (armFilters.has('fl_contrib')) params.set('fl_contrib', '1');
    if (armFilters.has('layer2')) params.set('layer2', '1');
    if (armFilters.has('sunbiz')) params.set('sunbiz', '1');
    const res = await fetch(`/api/uploads/${uploadId}/evidence?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Failed to load voters');
    setVoters(data.voters ?? []);
  }, [uploadId, nameFilter, armFilters]);

  const toggleArmFilter = (filter: VoterArmFilter) => {
    setArmFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  };

  const loadDetail = useCallback(
    async (voterRecordId: string) => {
      const res = await fetch(
        `/api/uploads/${uploadId}/evidence?voterRecordId=${encodeURIComponent(voterRecordId)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load voter evidence');
      setDetail(data);
    },
    [uploadId],
  );

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([refreshSummary(), refreshVoters()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [refreshSummary, refreshVoters]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId).catch((e) =>
      setError(e instanceof Error ? e.message : 'Detail load failed'),
    );
  }, [selectedId, loadDetail]);

  const selectedRow = useMemo(
    () => voters.find((v) => v.id === selectedId) ?? null,
    [voters, selectedId],
  );

  const unresolvedCommittees = useMemo(() => {
    if (!detail) return [];
    const names = new Set<string>();
    for (const ev of detail.events) {
      if (ev.arm !== 'fl_contrib') continue;
      for (const c of ev.payload?.unresolved_committees ?? []) {
        if (c?.trim()) names.add(c);
      }
    }
    return [...names];
  }, [detail]);

  const humanJudgmentEvent = useMemo(() => {
    if (!detail) return null;
    return (
      detail.events.find(
        (ev) => ev.arm === 'human_judgment' && ev.source === 'street_view_review',
      ) ?? null
    );
  }, [detail]);

  const reviewVoter = async (action: 'accept' | 'reopen' | 're_enroll') => {
    if (!detail) return;
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/voters/${detail.voter.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Review action failed');
      await Promise.all([loadDetail(detail.voter.id), refreshVoters(), refreshSummary()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review action failed');
    } finally {
      setSyncing(false);
    }
  };

  const reEnrollCohort = async (body: Record<string, unknown>, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/uploads/${uploadId}/re-enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Re-enroll failed');
      await refreshAll();
      if (selectedId) await loadDetail(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-enroll failed');
    } finally {
      setSyncing(false);
    }
  };

  const runEvidenceAction = async (action: Tier0Action) => {
    setSyncing(true);
    setSyncingAction(action);
    setError(null);
    try {
      const res = await fetch(`/api/uploads/${uploadId}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Action failed');
      await Promise.all([refreshSummary(), refreshVoters()]);
      if (selectedId) await loadDetail(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setSyncing(false);
      setSyncingAction(null);
    }
  };

  const pipelineSteps = useMemo(
    () =>
      summary
        ? buildPipelineSteps(summary, { tier0_running: syncing })
        : buildPipelineSteps({
            upload_id: uploadId,
            voter_count: upload?.row_count ?? 0,
            arms: {},
            fusion: {
              fused_count: 0,
              provisional_count: 0,
              conflicted_count: 0,
              undetermined_count: 0,
              by_lean: {},
            },
            settled: { by_tier: {}, by_arm: {}, total: 0 },
            review: { accepted_count: 0, re_enrolled_count: 0 },
            waterfall: {
              eligible_remaining: upload?.row_count ?? 0,
              eligible_by_tier: {},
              projected: null,
            },
            billing: null,
            fec_sweep: null,
            runs: { active: [], recent: [] },
            committees: { unlabeled_count: 0, voters_affected: 0 },
          }),
    [summary, syncing, uploadId, upload?.row_count],
  );

  const suggestedStep = useMemo(() => suggestNextStep(pipelineSteps), [pipelineSteps]);

  const fecImported = (summary?.arms.fec?.event_count ?? 0) > 0;

  const runTier0Action = async (action: Tier0Action, stepId: 4 | 5, stepTitle: string) => {
    const step = pipelineSteps.find((s) => s.id === stepId);
    if (step?.state === 'locked') return;
    if (step?.state === 'complete' && !confirmLongRerun(stepTitle)) return;
    await runEvidenceAction(action);
  };

  const tier0ButtonClass = (stepState: PipelineStepState, stepId: 4 | 5) => {
    const suggested = suggestedStep === stepId;
    const base =
      'rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50';
    if (stepState === 'locked') return `${base} border-white/10 opacity-40 cursor-not-allowed`;
    if (stepState === 'complete' && !suggested) {
      return `${base} border-emerald-400/40 bg-emerald-500/10 opacity-85`;
    }
    if (suggested) return `${base} border-amber-400/70 bg-amber-500/20 ring-1 ring-amber-400/50`;
    return `${base} border-amber-400/50 bg-amber-500/10`;
  };

  return (
    <section className="panel rounded-2xl p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Evidence accumulator</h2>
          <p className="mt-1 text-sm opacity-75">
            Run each enrichment step, then review fused lean and evidence per voter below.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/export/${uploadId}/deliverable?format=csv`}
            className="rounded-lg border border-emerald-400/50 bg-emerald-500/10 px-3 py-1.5 text-sm hover:opacity-80"
            title="Download the client's list with lean, confidence, source, and evidence appended to every row"
          >
            Download deliverable (CSV)
          </a>
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={loading}
            className="rounded-lg border px-3 py-1.5 text-sm hover:opacity-80 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/15 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide opacity-60">Pipeline</h3>
          {suggestedStep != null && (
            <p className="text-xs text-amber-200/90">
              Next: step {suggestedStep} — long runs require confirmation if already complete
            </p>
          )}
        </div>
        <PipelineFlowTrack steps={pipelineSteps} suggestedStep={suggestedStep} />
        {summary && (
          <LineScore
            summary={summary}
            onOpportunityAction={(id) => {
              if (id === 'label_committees') setCommitteeManagerOpen(true);
            }}
          />
        )}
        {summary && (
          <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs space-y-2">
            <span className="font-semibold uppercase tracking-wide opacity-60">
              Waterfall controls
            </span>
            {summary.waterfall.projected && (
              <p className="opacity-75">
                Max exposure if every remaining voter settles at the next arm: Tier 1 (FEC) $
                {summary.waterfall.projected.tier1_usd.toFixed(2)} · Tier 2 (FL/Sunbiz) $
                {summary.waterfall.projected.tier2_usd.toFixed(2)} · Tier 3 (OSINT) $
                {summary.waterfall.projected.tier3_usd.toFixed(2)} + $
                {summary.waterfall.projected.osint_attempts_usd.toFixed(2)} attempt fees
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={syncing}
                onClick={() =>
                  void reEnrollCohort(
                    { maxConfidence: 70 },
                    'Re-enroll settled voters with fused confidence ≤ 70 into later arms?\n\nBilling is unaffected (settlement fees are charged once, ever), but later paid arms will spend on these voters again.',
                  )
                }
                className="rounded-lg border border-sky-300/50 bg-sky-500/10 px-3 py-1 hover:opacity-90 disabled:opacity-50"
                title="Settled voters whose fused confidence is ≤ 70 re-enter later arms"
              >
                Re-enroll low-confidence (≤70)
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={() =>
                  void reEnrollCohort(
                    { tierLte: 1 },
                    'Re-enroll every FEC-settled (tier 1) voter into later arms for corroboration?\n\nBilling is unaffected, but later paid arms will spend on these voters again.',
                  )
                }
                className="rounded-lg border border-sky-300/50 bg-sky-500/10 px-3 py-1 hover:opacity-90 disabled:opacity-50"
                title="Voters settled at tier 1 (FEC) re-enter tier 2/3 arms for corroboration"
              >
                Re-enroll FEC-settled
              </button>
              {summary.review.re_enrolled_count > 0 && (
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() =>
                    void reEnrollCohort(
                      { action: 'withdraw' },
                      'Withdraw all re-enrollments? Settled voters go back to being excluded from later arms.',
                    )
                  }
                  className="rounded-lg border border-white/15 px-3 py-1 opacity-70 hover:opacity-100 disabled:opacity-50"
                >
                  Withdraw re-enrollments
                </button>
              )}
            </div>
          </div>
        )}
        <div className="grid gap-3 text-sm">
          <PipelineStepRow step={1}>
            <p className="text-xs opacity-85">
              <strong>Upload file</strong> — registration extract (+ optional history)
              {upload ? ` · ${upload.filename}` : ''}
            </p>
          </PipelineStepRow>
          <PipelineStepRow step={2}>
            <p className="text-xs opacity-85">
              <strong>Extract NPAs</strong> — NPA + Active at ingest
              {upload ? ` · ${upload.row_count} voters` : ''}
              {upload?.ballot_favors
                ? ` · scenario ${ballotFavorsLabel(upload.ballot_favors)}`
                : ''}
            </p>
          </PipelineStepRow>
          {upload && (
            <FecSweepPanel
              uploadId={uploadId}
              voterCount={upload.row_count}
              onImported={() => void refreshAll()}
              stepState={pipelineSteps.find((s) => s.id === 3)?.state ?? 'ready'}
              suggested={suggestedStep === 3}
              fecImported={fecImported}
            />
          )}
          <div className="flex flex-wrap gap-2 pt-1 pl-[calc(1.35rem+0.625rem)]">
            {(() => {
              const step4 = pipelineSteps.find((s) => s.id === 4)!;
              const step4Complete = step4.state === 'complete';
              return (
                <button
                  type="button"
                  onClick={() =>
                    void runTier0Action('match-fl-contrib', 4, 'FL contributors (person)')
                  }
                  disabled={syncing || step4.state === 'locked'}
                  title={
                    step4.state === 'locked'
                      ? 'Import FEC into the ledger first (step 3)'
                      : 'FL DOS bulk index — person-name contributions + household anchor'
                  }
                  className={tier0ButtonClass(step4.state, 4)}
                >
                  {syncingAction === 'match-fl-contrib' ? (
                    'Running…'
                  ) : step4Complete ? (
                    <>
                      <PipelineStepButtonLabel step={4} label="Complete ✓ · Re-run FL contributors" />
                    </>
                  ) : (
                    <PipelineStepButtonLabel step={4} label="Match FL contributors (person)" />
                  )}
                </button>
              );
            })()}
            {(() => {
              const step5 = pipelineSteps.find((s) => s.id === 5)!;
              const step5Complete = step5.state === 'complete';
              return (
                <button
                  type="button"
                  onClick={() =>
                    void runTier0Action('match-sunbiz-entity', 5, 'Sunbiz → FL entity')
                  }
                  disabled={syncing || step5.state === 'locked'}
                  title={
                    step5.state === 'locked'
                      ? 'Complete step 4 (FL contributors) first'
                      : 'Sunbiz officer match, then entity FL contributions (layer 2)'
                  }
                  className={tier0ButtonClass(step5.state, 5)}
                >
                  {syncingAction === 'match-sunbiz-entity' ? (
                    'Running…'
                  ) : step5Complete ? (
                    <PipelineStepButtonLabel
                      step={5}
                      label="Complete ✓ · Re-run Sunbiz → FL entity"
                    />
                  ) : (
                    <PipelineStepButtonLabel step={5} label="Sunbiz → FL entity contributions" />
                  )}
                </button>
              );
            })()}
            <button
              type="button"
              onClick={() => void runEvidenceAction('match-fec-index')}
              disabled={syncing}
              title="Tier 1 via the local FEC bulk index (no API, no throttle). Uploads over 5,000 voters: use scripts/run-fec-index.ts instead."
              className="rounded-lg border border-emerald-300/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              {syncingAction === 'match-fec-index' ? 'Running…' : 'Match FEC (local index)'}
            </button>
            <button
              type="button"
              onClick={() => setCommitteeManagerOpen(true)}
              className="rounded-lg border border-violet-300/50 px-3 py-1.5 text-xs hover:opacity-80"
            >
              Committee lean labels
            </button>
          </div>
          {/* Unlabeled-committee counts render once, in the line score's
              "On base" strip (BoxScoreOpportunity) — not here. */}
        </div>
      </div>

      <CommitteeLeanManager
        uploadId={uploadId}
        open={committeeManagerOpen}
        onClose={() => setCommitteeManagerOpen(false)}
      />

      {error && (
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      )}

      {/* Cumulative stats + per-arm counts live in the pinned box score / line score. */}

      {/* Split pane */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2 rounded-xl border border-white/10 bg-black/10 p-3 flex flex-col min-h-[320px] max-h-[520px]">
          <input
            type="text"
            placeholder="Filter by name…"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void refreshVoters()}
            className="mb-2 w-full rounded-lg border bg-black/20 px-3 py-2 text-sm"
          />
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(
              [
                { id: 'fec' as const, label: 'FEC✓', active: 'border-emerald-300/70 bg-emerald-500/15 text-emerald-200' },
                {
                  id: 'fl_contrib' as const,
                  label: 'FL contrib',
                  active: 'border-orange-300/70 bg-orange-500/15 text-orange-200',
                },
                {
                  id: 'layer2' as const,
                  label: 'FL entity',
                  active: 'border-sky-300/70 bg-sky-500/15 text-sky-200',
                },
                { id: 'sunbiz' as const, label: 'Sunbiz', active: 'border-amber-300/70 bg-amber-500/15 text-amber-200' },
              ] as const
            ).map((f) => {
              const on = armFilters.has(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => toggleArmFilter(f.id)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                    on ? f.active : 'border-white/15 bg-black/20 opacity-70 hover:opacity-100'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
            {(nameFilter.trim() || armFilters.size > 0) && (
              <button
                type="button"
                onClick={() => {
                  setNameFilter('');
                  setArmFilters(new Set());
                }}
                className="rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] opacity-60 hover:opacity-100"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-black/60">
                <tr className="opacity-70">
                  <th className="py-1 pr-2">Row</th>
                  <th className="py-1 pr-2">Name</th>
                  <th className="py-1 pr-2">Lean</th>
                  <th className="py-1">Arms</th>
                </tr>
              </thead>
              <tbody>
                {voters.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => setSelectedId(v.id)}
                    className={`cursor-pointer border-b border-white/5 hover:bg-white/5 ${
                      selectedId === v.id ? 'bg-emerald-500/15' : ''
                    }`}
                  >
                    <td className="py-1.5 pr-2 tabular-nums">{v.row_index}</td>
                    <td className="py-1.5 pr-2 max-w-[8rem] truncate">{v.raw_data.name.full}</td>
                    <td className="py-1.5 pr-2">
                      {v.review_status === 'accepted' && (
                        <span className="text-emerald-300" title="Accepted by researcher (frozen)">
                          ✓{' '}
                        </span>
                      )}
                      {v.lean ?? '—'}
                      {v.confidence != null && v.lean && v.lean !== 'Undetermined'
                        ? ` ${v.confidence}%`
                        : ''}
                    </td>
                    <td className="py-1.5">
                      {v.fec_confirmed || v.has_fl_contrib || v.has_layer2 || v.has_sunbiz ? (
                        <span className="flex flex-wrap gap-1">
                          {v.fec_confirmed && (
                            <span className="text-emerald-300" title="FEC confirmed donor">
                              FEC✓
                            </span>
                          )}
                          {v.has_fl_contrib && (
                            <span className="text-orange-300" title="FL contributor (person-name match)">
                              FL
                            </span>
                          )}
                          {v.has_layer2 && (
                            <span className="text-sky-300" title="FL contributor via Sunbiz entity">
                              Ent
                            </span>
                          )}
                          {v.has_sunbiz && (
                            <span className="text-amber-300" title="Sunbiz officer match">
                              SB
                            </span>
                          )}
                        </span>
                      ) : v.event_count > 0 ? (
                        <span className="opacity-60">{v.event_count}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-3 rounded-xl border border-white/10 bg-black/10 p-4 min-h-[320px]">
          {!selectedRow || !detail ? (
            <p className="text-sm opacity-60">Select a voter to view anchor, evidence timeline, and fusion.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide opacity-60">Voter anchor</h4>
                  <p className="mt-2 font-medium">{detail.voter.raw_data.name.full}</p>
                  <p className="text-sm opacity-80">{detail.voter.raw_data.residence.full}</p>
                  <p className="mt-1 text-xs opacity-60">
                    Row {detail.voter.row_index} · {detail.voter.raw_data.party} · precinct{' '}
                    {detail.voter.raw_data.precinct}
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                  {(() => {
                    const persisted = detail.fusion_persisted;
                    const accepted = persisted?.review_status === 'accepted';
                    const reEnrolled = persisted?.research_status === 're_enrolled';
                    // Acceptance freezes the persisted values; live fusion may drift
                    // if evidence keeps arriving, so show what the deliverable shows.
                    const shownLean = accepted ? persisted?.lean ?? 'Undetermined' : detail.fusion.lean;
                    const shownConfidence = accepted
                      ? persisted?.confidence ?? 0
                      : detail.fusion.confidence;
                    return (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wide opacity-60">
                            Fused lean
                          </h4>
                          <span className="flex flex-wrap gap-1.5">
                            {accepted && (
                              <span className="rounded-full border border-emerald-300/60 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200">
                                Accepted ✓
                              </span>
                            )}
                            {reEnrolled && !accepted && (
                              <span className="rounded-full border border-sky-300/60 bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-200">
                                Re-enrolled
                              </span>
                            )}
                            {persisted?.settled_tier != null && (
                              <span
                                className="rounded-full border border-amber-300/50 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200"
                                title="Billed once at this arm's tier; later research never re-bills"
                              >
                                Settled: {persisted.settled_arm} (T{persisted.settled_tier})
                              </span>
                            )}
                          </span>
                        </div>
                        <p className="mt-2 text-lg font-semibold">
                          {shownLean}
                          {shownConfidence > 0 && (
                            <span className="ml-2 text-sm font-normal opacity-80">
                              {shownConfidence}%
                            </span>
                          )}
                        </p>
                        <p className="text-xs opacity-70">
                          Status: {accepted ? 'accepted (frozen)' : detail.fusion.fusion_status}
                          {detail.fusion.contributing_arms.length > 0 &&
                            ` · arms: ${detail.fusion.contributing_arms.join(', ')}`}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {!accepted && detail.fusion.lean !== 'Undetermined' && (
                            <button
                              type="button"
                              disabled={syncing}
                              onClick={() => void reviewVoter('accept')}
                              title="Affirm this lean as final: freezes the deliverable values and closes research for this voter"
                              className="rounded-lg border border-emerald-400/60 bg-emerald-500/15 px-3 py-1 text-xs font-medium hover:opacity-90 disabled:opacity-50"
                            >
                              Accept lean
                            </button>
                          )}
                          {accepted && (
                            <button
                              type="button"
                              disabled={syncing}
                              onClick={() => void reviewVoter('reopen')}
                              title="Clear the acceptance: fusion resumes and the voter can re-enter arms"
                              className="rounded-lg border border-white/20 px-3 py-1 text-xs hover:opacity-90 disabled:opacity-50"
                            >
                              Reopen
                            </button>
                          )}
                          {!accepted && persisted?.settled_tier != null && !reEnrolled && (
                            <button
                              type="button"
                              disabled={syncing}
                              onClick={() => void reviewVoter('re_enroll')}
                              title="Push this settled voter back into later arms (billing unaffected)"
                              className="rounded-lg border border-sky-300/50 bg-sky-500/10 px-3 py-1 text-xs hover:opacity-90 disabled:opacity-50"
                            >
                              Re-enroll
                            </button>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {unresolvedCommittees.length > 0 && (
                <div className="rounded-lg border border-violet-300/25 bg-violet-500/5 px-3 py-2 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-violet-200/90">
                    Unresolved committees
                  </p>
                  <p className="mt-1 text-xs opacity-75">
                    No automatic lean — label to apply across linked NPAs.
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {unresolvedCommittees.map((name) => (
                      <li key={name} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs opacity-90">{name}</span>
                        <CommitteeQuickLabel
                          uploadId={uploadId}
                          committeeName={name}
                          onSaved={() => void loadDetail(detail.voter.id)}
                        />
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => setCommitteeManagerOpen(true)}
                    className="mt-2 text-xs text-violet-200 underline opacity-80 hover:opacity-100"
                  >
                    Open full committee manager
                  </button>
                </div>
              )}

              <ResidenceTiebreaker
                uploadId={uploadId}
                voterRecordId={detail.voter.id}
                fusedLean={detail.fusion.lean}
                humanEvent={humanJudgmentEvent}
                onSaved={() => void loadDetail(detail.voter.id)}
              />

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-2">
                  Evidence timeline
                </h4>
                {detail.events.length === 0 ? (
                  <p className="text-sm opacity-60">No evidence events yet. Run an arm (e.g. FEC sweep).</p>
                ) : (
                  <ul className="max-h-64 space-y-2 overflow-auto text-sm">
                    {detail.events.map((ev) => (
                      <li
                        key={ev.id}
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-medium">
                            {ev.arm === 'human_judgment' ? 'Human estimate' : ev.arm} · {ev.source}
                            {ev.arm === 'human_judgment' && (
                              <span className="ml-1 text-violet-300">(researcher)</span>
                            )}
                          </span>
                          <span className="text-xs opacity-60">
                            {new Date(ev.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-xs opacity-80 mt-1">
                          Identity: {ev.identity_band ?? '—'}
                          {ev.identity_score != null && ` (${Math.round(ev.identity_score * 100)}%)`}
                          {ev.probable_same_person ? ' · match' : ''}
                          {ev.lean_signal && ev.lean_signal !== 'Undetermined'
                            ? ` · lean ${ev.lean_signal}`
                            : ''}
                        </p>
                        {ev.evidence.map((line) => (
                          <p key={line} className="text-xs opacity-70 mt-0.5">
                            {line}
                          </p>
                        ))}
                        {ev.urls.length > 0 && (
                          <ul className="mt-1 text-xs">
                            {ev.urls.slice(0, 3).map((url) => (
                              <li key={url}>
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-emerald-300 hover:underline break-all"
                                >
                                  {url}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}