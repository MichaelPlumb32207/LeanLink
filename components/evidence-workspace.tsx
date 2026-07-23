'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArmDetailPanel } from '@/components/arm-detail-panel';
import { CommitteeLeanManager } from '@/components/committee-lean-manager';
import { CommitteeQuickLabel } from '@/components/committee-quick-label';
import { LineScore } from '@/components/box-score';
import { ResidenceTiebreaker } from '@/components/residence-tiebreaker';
import { confirmLongRerun, useEvidenceActions } from '@/components/use-evidence-actions';
import type { UploadEvidenceSummary } from '@/lib/evidence/types';
import {
  LEAN_PRECEDENCE_OPTIONS,
  type LeanPrecedenceMode,
} from '@/lib/lean-precedence';

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
  lean_precedence?: string | null;
};

export function EvidenceWorkspace({
  uploadId,
  upload,
  summary,
  refreshSummary,
  leanPrecedence,
  onLeanPrecedenceChange,
  precedenceBusy,
}: {
  uploadId: string;
  upload?: EvidenceUploadMeta | null;
  /** Owned by the page-level useEvidenceSummary hook (single polling loop). */
  summary: UploadEvidenceSummary | null;
  refreshSummary: () => Promise<void>;
  /** D-044 — when party and wallet disagree, who wins on the deliverable. */
  leanPrecedence?: LeanPrecedenceMode;
  onLeanPrecedenceChange?: (mode: LeanPrecedenceMode) => void;
  precedenceBusy?: boolean;
}) {
  const [voters, setVoters] = useState<VoterListRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VoterDetail | null>(null);
  const [nameFilter, setNameFilter] = useState('');
  const [debouncedName, setDebouncedName] = useState('');
  const [armFilters, setArmFilters] = useState<Set<VoterArmFilter>>(new Set());
  const [total, setTotal] = useState(0);
  const [loadingVoters, setLoadingVoters] = useState(false);
  const voterReqSeq = useRef(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committeeManagerOpen, setCommitteeManagerOpen] = useState(false);
  const [selectedArm, setSelectedArm] = useState<string | null>(null);

  // Debounce the name box so we don't fire a server round-trip per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedName(nameFilter), 300);
    return () => clearTimeout(t);
  }, [nameFilter]);

  // Voter-list fetch. A monotonic seq makes it latest-wins: a slow earlier
  // response can't clobber a newer filter's result. Optional AbortSignal also
  // cancels the network. Deliberately NOT coupled to the summary poll.
  const loadVoters = useCallback(
    async (signal?: AbortSignal) => {
      const seq = ++voterReqSeq.current;
      const params = new URLSearchParams({ list: '1', limit: '1000' });
      if (debouncedName.trim()) params.set('name', debouncedName.trim());
      if (armFilters.has('fec')) params.set('fec', '1');
      if (armFilters.has('fl_contrib')) params.set('fl_contrib', '1');
      if (armFilters.has('layer2')) params.set('layer2', '1');
      if (armFilters.has('sunbiz')) params.set('sunbiz', '1');
      setLoadingVoters(true);
      try {
        const res = await fetch(`/api/uploads/${uploadId}/evidence?${params}`, signal ? { signal } : {});
        const data = await res.json();
        if (seq !== voterReqSeq.current) return; // a newer request superseded us
        if (!res.ok) throw new Error(data.error ?? 'Failed to load voters');
        setVoters(data.voters ?? []);
        setTotal(typeof data.total === 'number' ? data.total : (data.voters?.length ?? 0));
      } finally {
        if (seq === voterReqSeq.current) setLoadingVoters(false);
      }
    },
    [uploadId, debouncedName, armFilters],
  );

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
      await Promise.all([refreshSummary(), loadVoters()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [refreshSummary, loadVoters]);

  // Re-fetch the voter list on upload/name/filter change only — abortable and
  // decoupled from the summary poll, so a 5s box-score tick never reloads the
  // 1000-row list (that coupling was the "slow / needs a 2nd click" bug).
  useEffect(() => {
    const ac = new AbortController();
    void loadVoters(ac.signal).catch((e) => {
      if ((e as Error)?.name !== 'AbortError') {
        setError(e instanceof Error ? e.message : 'Load failed');
      }
    });
    return () => ac.abort();
  }, [loadVoters]);

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
      await Promise.all([loadDetail(detail.voter.id), loadVoters(), refreshSummary()]);
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

  // Single evidence-action code path shared by the old step buttons and the new
  // arm detail panels (ENH-019 Phase 1). onAfter mirrors the old runEvidenceAction.
  const afterAction = useCallback(async () => {
    await Promise.all([refreshSummary(), loadVoters()]);
    if (selectedId) await loadDetail(selectedId);
  }, [refreshSummary, loadVoters, selectedId, loadDetail]);

  const {
    runAction,
    busyAction,
    busy: actionBusy,
    error: actionError,
  } = useEvidenceActions(uploadId, afterAction);

  // Any long-running action (evidence arm OR review/re-enroll) disables the rest.
  const anyBusy = syncing || actionBusy;

  // Clicking an inning both expands its panel AND filters the voter list to that
  // arm's hits — reuses the existing armFilters machinery (no new query). OSINT
  // has no list filter; collapsing clears the filter.
  const ARM_LIST_FILTER: Record<string, VoterArmFilter | undefined> = {
    fec: 'fec',
    fl_contrib: 'fl_contrib',
    sunbiz: 'sunbiz',
  };
  const handleSelectArm = (arm: string | null) => {
    setSelectedArm(arm);
    const filter = arm ? ARM_LIST_FILTER[arm] : undefined;
    setArmFilters(filter ? new Set([filter]) : new Set());
  };

  return (
    <section className="panel rounded-2xl p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Evidence accumulator</h2>
          <p className="mt-1 text-sm opacity-75">
            Click any inning to run its arm and see its detail; review fused lean per voter below.
            {upload?.filename ? ` · ${upload.filename}` : ''}
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

      {onLeanPrecedenceChange && (
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="lean-precedence" className="text-sm font-medium">
              Lean conflict rule (deliverable)
            </label>
            <select
              id="lean-precedence"
              value={leanPrecedence ?? 'wallet'}
              disabled={precedenceBusy}
              onChange={(e) =>
                onLeanPrecedenceChange(e.target.value as LeanPrecedenceMode)
              }
              className="rounded-lg border border-white/20 bg-black/40 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {LEAN_PRECEDENCE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs opacity-70">
            {LEAN_PRECEDENCE_OPTIONS.find((o) => o.id === (leanPrecedence ?? 'wallet'))
              ?.description ??
              'When registration party and public donation evidence disagree, who wins on the client file. Default: wallet (they lean the way their wallet leans). Does not rewrite fusion research rows — export only.'}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-black/15 p-4 space-y-4">
        {summary && (
          <LineScore
            summary={summary}
            selectedArm={selectedArm}
            onSelectArm={handleSelectArm}
            renderDetail={(arm) => (
              <ArmDetailPanel
                arm={arm}
                summary={summary}
                uploadId={uploadId}
                runAction={runAction}
                busyAction={busyAction}
                busy={anyBusy}
                confirmLongRerun={confirmLongRerun}
                onOpenCommitteeManager={() => setCommitteeManagerOpen(true)}
              />
            )}
            onOpportunityAction={(id) => {
              // Both open the committee manager — it hosts the label queue AND the
              // "Re-fuse now" action for the labeled-but-unfused pending strip.
              if (id === 'label_committees' || id === 'refuse_committees') {
                setCommitteeManagerOpen(true);
              }
            }}
          />
        )}
        {summary && (
          <details className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-semibold uppercase tracking-wide opacity-60">
              Waterfall controls (advanced)
            </summary>
            <div className="mt-2 space-y-2">
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
                disabled={anyBusy}
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
                disabled={anyBusy}
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
                  disabled={anyBusy}
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
          </details>
        )}
      </div>

      <CommitteeLeanManager
        uploadId={uploadId}
        open={committeeManagerOpen}
        onClose={() => setCommitteeManagerOpen(false)}
        onStarted={() => void refreshSummary()}
      />

      {(error ?? actionError) && (
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error ?? actionError}
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
            onKeyDown={(e) => e.key === 'Enter' && setDebouncedName(nameFilter)}
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
          <div className="mb-1.5 flex items-center justify-between text-[11px] opacity-60">
            <span>
              {total.toLocaleString()} {total === 1 ? 'voter' : 'voters'}
              {armFilters.size > 0 || debouncedName.trim() ? ' match' : ''}
              {voters.length < total ? ` · showing first ${voters.length.toLocaleString()}` : ''}
            </span>
            {loadingVoters && <span className="animate-pulse">updating…</span>}
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
                              disabled={anyBusy}
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
                              disabled={anyBusy}
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
                              disabled={anyBusy}
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