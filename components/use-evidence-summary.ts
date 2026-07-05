'use client';

/**
 * The one polling loop behind the box score. Single source: GET
 * /api/uploads/[id]/evidence-summary. Cadence tightens to 5s while a run is
 * active; the 30s idle poll is what makes CLI-started runs discoverable
 * without any UI action. Pauses entirely while the tab is hidden.
 */
import { useCallback, useEffect, useState } from 'react';
import type { UploadEvidenceSummary } from '@/lib/evidence/types';

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;

export function summaryHasActiveRun(summary: UploadEvidenceSummary | null): boolean {
  if ((summary?.runs?.active.length ?? 0) > 0) return true;
  // Pre-migration-014 fallback: the API sweep's own status field.
  const status = summary?.fec_sweep?.status;
  return status === 'queued' || status === 'running';
}

export function useEvidenceSummary(uploadId: string | null): {
  summary: UploadEvidenceSummary | null;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
} {
  const [summary, setSummary] = useState<UploadEvidenceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!uploadId) return;
    try {
      const res = await fetch(`/api/uploads/${uploadId}/evidence-summary`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load evidence summary');
      setSummary(data.summary as UploadEvidenceSummary);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load evidence summary');
    }
  }, [uploadId]);

  useEffect(() => {
    setSummary(null);
    setError(null);
    setLastUpdated(null);
    if (uploadId) void refresh();
  }, [uploadId, refresh]);

  const active = summaryHasActiveRun(summary);

  useEffect(() => {
    if (!uploadId) return;
    const intervalMs = active ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (!timer) timer = setInterval(() => void refresh(), intervalMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [uploadId, active, refresh]);

  return { summary, error, lastUpdated, refresh };
}
