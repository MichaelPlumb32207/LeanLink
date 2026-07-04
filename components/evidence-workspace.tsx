'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CommitteeLeanManager } from '@/components/committee-lean-manager';
import { CommitteeQuickLabel } from '@/components/committee-quick-label';
import { FecSweepPanel } from '@/components/fec-sweep-panel';
import { PipelineStepButtonLabel, PipelineStepRow } from '@/components/pipeline-step';
import { PipelineFlowTrack, PipelineScoreboardPanel } from '@/components/pipeline-scoreboard';
import { ResidenceTiebreaker } from '@/components/residence-tiebreaker';
import { ballotFavorsLabel } from '@/lib/ballot-favors';
import { EVIDENCE_ARMS } from '@/lib/evidence/arms';
import type { UploadEvidenceSummary } from '@/lib/evidence/types';
import {
  buildPipelineScoreboard,
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
};

type EvidenceUploadMeta = {
  filename: string;
  row_count: number;
  ballot_favors?: string | null;
};

type Tier0Action = 'match-fl-contrib' | 'match-sunbiz-entity' | 'match-tier0-all';

export function EvidenceWorkspace({
  uploadId,
  upload,
}: {
  uploadId: string;
  upload?: EvidenceUploadMeta | null;
}) {
  const [summary, setSummary] = useState<UploadEvidenceSummary | null>(null);
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

  const refreshSummary = useCallback(async () => {
    const res = await fetch(`/api/uploads/${uploadId}/evidence-summary`);
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, data.hint].filter(Boolean).join(' — '));
    setSummary(data.summary);
  }, [uploadId]);

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
    const fecStatus = summary?.fec_sweep?.status;
    const fecRunning = fecStatus === 'running' || fecStatus === 'queued';
    if (!fecRunning) return;
    const id = window.setInterval(() => {
      void refreshSummary().catch(() => {});
    }, 5000);
    return () => window.clearInterval(id);
  }, [summary?.fec_sweep?.status, refreshSummary]);

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
      if (data.summary) setSummary(data.summary);
      await refreshVoters();
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
            settled: { by_tier: {}, total: 0 },
            billing: null,
            fec_sweep: null,
          }),
    [summary, syncing, uploadId, upload?.row_count],
  );

  const pipelineScoreboard = useMemo(
    () => (summary ? buildPipelineScoreboard(summary) : null),
    [summary],
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

  const fecArm = summary?.arms.fec;
  const fusedCount = summary?.fusion.fused_count ?? 0;
  const provisionalCount = summary?.fusion.provisional_count ?? 0;

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
        {pipelineScoreboard && <PipelineScoreboardPanel score={pipelineScoreboard} />}
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
              onClick={() => setCommitteeManagerOpen(true)}
              className="rounded-lg border border-violet-300/50 px-3 py-1.5 text-xs hover:opacity-80"
            >
              Committee lean labels
            </button>
          </div>
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

      {/* Command bar */}
      <div className="rounded-xl border border-white/15 bg-black/20 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="rounded-lg bg-black/25 px-3 py-2 text-center">
            <div className="text-2xl font-semibold tabular-nums">
              {pipelineScoreboard?.npas_in_file ?? summary?.voter_count ?? '—'}
            </div>
            <div className="text-[10px] uppercase tracking-wide opacity-60">NPAs in file</div>
          </div>
          <div className="rounded-lg bg-black/25 px-3 py-2 text-center">
            <div className="text-2xl font-semibold tabular-nums text-emerald-300">
              {summary?.fec_sweep?.confirmed_hits ?? '—'}
            </div>
            <div className="text-[10px] uppercase tracking-wide opacity-60">FEC confirmed</div>
          </div>
          <div className="rounded-lg bg-black/25 px-3 py-2 text-center">
            <div className="text-2xl font-semibold tabular-nums text-emerald-300">
              {pipelineScoreboard?.labeled_count ?? fusedCount + provisionalCount}
            </div>
            <div className="text-[10px] uppercase tracking-wide opacity-60">
              Labeled now
              {pipelineScoreboard ? ` (${pipelineScoreboard.labeled_pct}%)` : ''}
            </div>
          </div>
          <div className="rounded-lg bg-black/25 px-3 py-2 text-center">
            <div className="text-2xl font-semibold tabular-nums">
              ${(fecArm?.total_cost_usd ?? 0).toFixed(2)}
            </div>
            <div className="text-[10px] uppercase tracking-wide opacity-60">FEC cost</div>
          </div>
          <div className="rounded-lg bg-black/25 px-3 py-2 text-center sm:col-span-2">
            <div className="text-sm font-medium">
              FEC sweep: {summary?.fec_sweep?.status ?? 'not started'}
              {summary?.fec_sweep
                ? ` · ${summary.fec_sweep.processed_count}/${summary.voter_count}`
                : ''}
            </div>
            <div className="text-xs opacity-70">
              {summary?.fec_sweep?.raw_hits ?? 0} raw hits · OSINT arm:{' '}
              {summary?.arms.osint?.event_count ?? 0} events
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {EVIDENCE_ARMS.filter((a) => a.default_enabled || summary?.arms[a.id]).map((arm) => {
            const stats = summary?.arms[arm.id];
            return (
              <span
                key={arm.id}
                className="rounded-full border border-white/15 bg-black/30 px-2.5 py-1 text-xs"
                title={arm.description}
              >
                {arm.label}
                {stats ? ` · ${stats.event_count}` : ''}
                {stats && stats.lean_signal_count > 0 ? ` · ${stats.lean_signal_count} lean` : ''}
              </span>
            );
          })}
        </div>
      </div>

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
                  <h4 className="text-xs font-semibold uppercase tracking-wide opacity-60">Fused lean</h4>
                  <p className="mt-2 text-lg font-semibold">
                    {detail.fusion.lean}
                    {detail.fusion.confidence > 0 && (
                      <span className="ml-2 text-sm font-normal opacity-80">
                        {detail.fusion.confidence}%
                      </span>
                    )}
                  </p>
                  <p className="text-xs opacity-70">
                    Status: {detail.fusion.fusion_status}
                    {detail.fusion.contributing_arms.length > 0 &&
                      ` · arms: ${detail.fusion.contributing_arms.join(', ')}`}
                  </p>
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