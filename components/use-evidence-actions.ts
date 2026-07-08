'use client';

import { useCallback, useState } from 'react';

/**
 * Single implementation of the evidence-action POST machinery (ENH-019 Phase 1).
 * Extracted from evidence-workspace so the old step buttons and the new arm
 * detail panels share ONE code path — same endpoint, same error handling.
 * Behavior is byte-for-byte the pre-refactor `runEvidenceAction`.
 */
export type EvidenceActionId =
  | 'match-fl-contrib'
  | 'match-sunbiz-entity'
  | 'match-tier0-all'
  | 'match-fec-index';

/**
 * Confirm a re-run of an arm that already completed on this upload. Lives here
 * (not in the Phase-2-doomed pipeline-status.ts) so the guard survives that
 * deletion — ENH-019 amendment 4.
 */
export function confirmLongRerun(label: string): boolean {
  return window.confirm(
    `${label} already ran on this upload.\n\nRe-running can take a long time and will refresh evidence for all voters.\n\nContinue?`,
  );
}

export interface EvidenceActions {
  runAction: (action: EvidenceActionId) => Promise<void>;
  busyAction: EvidenceActionId | null;
  busy: boolean;
  error: string | null;
  clearError: () => void;
}

export function useEvidenceActions(
  uploadId: string,
  /** Refresh summary + voter list + selected detail after a successful action. */
  onAfter: () => Promise<void>,
): EvidenceActions {
  const [busyAction, setBusyAction] = useState<EvidenceActionId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = useCallback(
    async (action: EvidenceActionId) => {
      setBusyAction(action);
      setError(null);
      try {
        const res = await fetch(`/api/uploads/${uploadId}/evidence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Action failed');
        await onAfter();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setBusyAction(null);
      }
    },
    [uploadId, onAfter],
  );

  return {
    runAction,
    busyAction,
    busy: busyAction !== null,
    error,
    clearError: () => setError(null),
  };
}
