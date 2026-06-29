'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EVIDENCE_ARMS } from '@/lib/evidence/arms';
import type { UploadEvidenceSummary } from '@/lib/evidence/types';

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
};

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

export function EvidenceWorkspace({ uploadId }: { uploadId: string }) {
  const [summary, setSummary] = useState<UploadEvidenceSummary | null>(null);
  const [voters, setVoters] = useState<VoterListRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VoterDetail | null>(null);
  const [nameFilter, setNameFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSummary = useCallback(async () => {
    const res = await fetch(`/api/uploads/${uploadId}/evidence-summary`);
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, data.hint].filter(Boolean).join(' — '));
    setSummary(data.summary);
  }, [uploadId]);

  const refreshVoters = useCallback(async () => {
    const params = new URLSearchParams({ list: '1', limit: '1000' });
    if (nameFilter.trim()) params.set('name', nameFilter.trim());
    const res = await fetch(`/api/uploads/${uploadId}/evidence?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Failed to load voters');
    setVoters(data.voters ?? []);
  }, [uploadId, nameFilter]);

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

  const handleSyncFec = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/uploads/${uploadId}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-fec' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      if (data.summary) setSummary(data.summary);
      await refreshVoters();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
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
            Multi-arm ledger with per-source identity gates and fused lean labels.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={loading}
            className="rounded-lg border px-3 py-1.5 text-sm hover:opacity-80 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleSyncFec()}
            disabled={syncing}
            className="rounded-lg border border-emerald-400/50 px-3 py-1.5 text-sm hover:opacity-80 disabled:opacity-50"
          >
            {syncing ? 'Syncing FEC…' : 'Sync FEC → ledger'}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      )}

      {/* Command bar */}
      <div className="rounded-xl border border-white/15 bg-black/20 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="rounded-lg bg-black/25 px-3 py-2 text-center">
            <div className="text-2xl font-semibold tabular-nums">{summary?.voter_count ?? '—'}</div>
            <div className="text-[10px] uppercase tracking-wide opacity-60">NPAs</div>
          </div>
          <div className="rounded-lg bg-black/25 px-3 py-2 text-center">
            <div className="text-2xl font-semibold tabular-nums text-emerald-300">
              {summary?.fec_sweep?.confirmed_hits ?? '—'}
            </div>
            <div className="text-[10px] uppercase tracking-wide opacity-60">FEC confirmed</div>
          </div>
          <div className="rounded-lg bg-black/25 px-3 py-2 text-center">
            <div className="text-2xl font-semibold tabular-nums">
              {fusedCount + provisionalCount}
            </div>
            <div className="text-[10px] uppercase tracking-wide opacity-60">Labeled (fused)</div>
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
                      {v.fec_confirmed ? (
                        <span className="text-emerald-300">FEC✓</span>
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
                            {ev.arm} · {ev.source}
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