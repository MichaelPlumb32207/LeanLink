'use client';

import { useCallback, useEffect, useState } from 'react';

type FecSweepJob = {
  id: string;
  status: string;
  processed_count: number;
  failed_count: number;
  hits_count: number;
  confirmed_hits_count?: number;
  total_count: number;
  error_message?: string | null;
};

export function FecSweepPanel({
  uploadId,
  voterCount,
  onImported,
}: {
  uploadId: string;
  voterCount: number;
  onImported?: () => void;
}) {
  const [job, setJob] = useState<FecSweepJob | null>(null);
  const [hitRate, setHitRate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/uploads/${uploadId}/fec-sweep`);
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, data.hint].filter(Boolean).join(' — '));
    setJob(data.job ?? null);
    setHitRate(typeof data.hit_rate_pct === 'number' ? data.hit_rate_pct : null);
  }, [uploadId]);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (!job || (job.status !== 'running' && job.status !== 'queued')) return;
    const id = window.setInterval(() => {
      void refresh().catch(() => {});
    }, 5000);
    return () => window.clearInterval(id);
  }, [job, refresh]);

  const startSweep = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/uploads/${uploadId}/fec-sweep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const data = await res.json();
      if (res.status === 409) {
        if (data.job) setJob(data.job);
        else await refresh();
        return;
      }
      if (!res.ok) throw new Error([data.error, data.hint].filter(Boolean).join(' — '));
      if (data.job) setJob(data.job);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'FEC sweep failed');
    } finally {
      setBusy(false);
    }
  };

  const importToLedger = async () => {
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/uploads/${uploadId}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-fec' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Import failed');
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const progressPct =
    job && job.total_count > 0
      ? Math.min(100, Math.round((job.processed_count / job.total_count) * 100))
      : 0;

  const running = job?.status === 'running' || job?.status === 'queued';

  return (
    <div className="rounded-lg border border-sky-400/30 bg-sky-950/20 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void startSweep()}
          disabled={busy || running}
          className="rounded-lg border border-sky-400/50 bg-sky-500/15 px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Starting…' : running ? 'FEC match running…' : '③ Run FEC federal match'}
        </button>
        <button
          type="button"
          onClick={() => void importToLedger()}
          disabled={importing || job?.status !== 'completed'}
          title="Copy completed FEC sweep into evidence ledger"
          className="rounded-lg border border-emerald-400/50 px-3 py-1.5 text-xs hover:opacity-90 disabled:opacity-50"
        >
          {importing ? 'Importing…' : 'Import FEC → ledger'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-200">{error}</p>}
      {job ? (
        <p className="mt-2 text-xs opacity-80">
          {job.status.toUpperCase()} · {job.processed_count}/{job.total_count} voters
          {job.hits_count > 0 ? ` · ${job.hits_count} raw` : ''}
          {(job.confirmed_hits_count ?? 0) > 0 ? ` · ${job.confirmed_hits_count} FEC✓` : ''}
          {hitRate != null && job.processed_count > 0 ? ` · ${hitRate}% hit rate` : ''}
          {running && ` · ${progressPct}%`}
        </p>
      ) : (
        <p className="mt-2 text-xs opacity-60">
          Match all {voterCount} NPAs against federal FEC Schedule A (background job).
        </p>
      )}
    </div>
  );
}