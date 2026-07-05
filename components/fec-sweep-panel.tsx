'use client';

import { useCallback, useEffect, useState } from 'react';
import { PipelineStepButtonLabel, PipelineStepRow } from '@/components/pipeline-step';
import { confirmLongRerun } from '@/lib/pipeline-status';
import type { PipelineStepState } from '@/lib/pipeline-status';

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
  stepState = 'ready',
  suggested = false,
  fecImported = false,
}: {
  uploadId: string;
  voterCount: number;
  onImported?: () => void;
  stepState?: PipelineStepState;
  suggested?: boolean;
  fecImported?: boolean;
}) {
  const [job, setJob] = useState<FecSweepJob | null>(null);
  const [hitRate, setHitRate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
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

  // No polling loop here: live progress renders in the pinned box score, fed by
  // the page-level useEvidenceSummary hook. This panel refreshes on mount and
  // after its own start/import actions (it carries job details the summary doesn't).

  const running = job?.status === 'running' || job?.status === 'queued';
  const completed = job?.status === 'completed';

  const startSweep = async () => {
    if (completed && !confirmLongRerun('FEC federal match')) return;
    setBusy(true);
    setError(null);
    setImportDone(false);
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
      setImportDone(true);
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

  const locked = stepState === 'locked';

  return (
    <PipelineStepRow step={3}>
      <div
        className={`rounded-lg border px-3 py-2.5 ${
          suggested
            ? 'border-amber-400/50 bg-amber-950/25 ring-1 ring-amber-400/40'
            : stepState === 'complete' || fecImported
              ? 'border-emerald-400/30 bg-emerald-950/20'
              : 'border-sky-400/30 bg-sky-950/20'
        }`}
      >
        <p className="mb-2 text-xs font-medium opacity-90">Federal FEC match</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void startSweep()}
            disabled={busy || running || locked}
            title={locked ? 'Complete earlier pipeline steps first' : undefined}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50 ${
              completed && !running
                ? 'border-white/20 bg-black/20 opacity-70'
                : suggested
                  ? 'border-amber-400/60 bg-amber-500/20'
                  : 'border-sky-400/50 bg-sky-500/15'
            }`}
          >
            {busy ? (
              'Starting…'
            ) : running ? (
              'FEC match running…'
            ) : completed ? (
              fecImported ? 'Complete ✓ · Re-run FEC match' : 'Re-run FEC federal match'
            ) : (
              <PipelineStepButtonLabel step={3} label="Run FEC federal match" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void importToLedger()}
            disabled={importing || !completed}
            title={
              completed
                ? 'Copy completed FEC sweep into evidence ledger'
                : 'Available when FEC match status is completed'
            }
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-40 ${
              fecImported
                ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100 opacity-80'
                : completed && suggested
                  ? 'border-amber-400/60 bg-amber-500/20 text-amber-100'
                  : completed
                    ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100'
                    : 'border-white/15 bg-black/20'
            }`}
          >
            {importing
              ? 'Importing…'
              : fecImported
                ? 'Complete ✓ · Re-import FEC'
                : 'Import FEC → ledger'}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-200">{error}</p>}
        {importDone && (
          <p className="mt-2 text-xs text-emerald-200">
            FEC sweep imported into evidence ledger — check FEC✓ filter below.
          </p>
        )}
        {job ? (
          <p className="mt-2 text-xs opacity-80">
            <span className={completed ? 'text-emerald-200/90 font-medium' : ''}>
              {job.status.toUpperCase()}
            </span>
            {' · '}
            {job.processed_count}/{job.total_count} voters
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
        {completed && !importDone && (
          <p className="mt-1 text-xs text-amber-200/90">
            Match complete — click <strong>Import FEC → ledger</strong> to show FEC✓ in the voter
            list.
          </p>
        )}
      </div>
    </PipelineStepRow>
  );
}