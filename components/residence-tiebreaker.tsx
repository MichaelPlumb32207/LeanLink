'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeanLabel } from '@/lib/enrichment/types';

type ResidenceContext = {
  address: string | null;
  maps_search_url: string | null;
  street_view_url: string | null;
  street_view: {
    status: string;
    address_used: string | null;
    image_data_url: string | null;
    error_message: string | null;
  };
};

type HumanJudgmentEvent = {
  lean_signal: string | null;
  lean_confidence: number | null;
  evidence: string[];
  created_at: string;
};

const LEAN_OPTIONS: { value: LeanLabel; label: string }[] = [
  { value: 'Left', label: 'Left' },
  { value: 'Right', label: 'Right' },
  { value: 'Independent', label: 'Independent' },
  { value: 'Undetermined', label: 'No lean / clear' },
];

export function ResidenceTiebreaker({
  uploadId,
  voterRecordId,
  fusedLean,
  humanEvent,
  onSaved,
}: {
  uploadId: string;
  voterRecordId: string;
  fusedLean: string;
  humanEvent: HumanJudgmentEvent | null;
  onSaved: () => void;
}) {
  const [context, setContext] = useState<ResidenceContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lean, setLean] = useState<LeanLabel>(
    (humanEvent?.lean_signal as LeanLabel) ?? 'Undetermined',
  );
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState(fusedLean === 'Undetermined');

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/uploads/${uploadId}/evidence/residence-context?voterRecordId=${encodeURIComponent(voterRecordId)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load residence context');
      setContext(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [uploadId, voterRecordId]);

  useEffect(() => {
    setContext(null);
    setError(null);
    if (expanded) void loadContext();
  }, [expanded, loadContext, voterRecordId]);

  useEffect(() => {
    setLean((humanEvent?.lean_signal as LeanLabel) ?? 'Undetermined');
    setNote('');
  }, [humanEvent, voterRecordId]);

  const saveGuess = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/uploads/${uploadId}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'human-lean-guess',
          voterRecordId,
          lean,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const humanSummary = useMemo(() => {
    if (!humanEvent?.lean_signal || humanEvent.lean_signal === 'Undetermined') return null;
    const conf =
      humanEvent.lean_confidence != null ? ` · ${humanEvent.lean_confidence}%` : '';
    return `${humanEvent.lean_signal}${conf}`;
  }, [humanEvent]);

  return (
    <div className="rounded-lg border border-violet-300/30 bg-violet-500/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-violet-200/90">
            Researcher tiebreaker
          </h4>
          <p className="mt-1 text-xs opacity-75">
            Street View + map for records still unknown after automated arms. Your estimate is
            stored as <strong>human-made</strong> and does not change fused lean.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-lg border border-violet-300/40 px-2.5 py-1 text-xs hover:bg-violet-500/10"
        >
          {expanded ? 'Collapse' : 'Open review'}
        </button>
      </div>

      {humanSummary && (
        <p className="mt-2 text-sm">
          <span className="rounded-full border border-violet-300/50 bg-violet-500/15 px-2 py-0.5 text-violet-100">
            Human estimate: {humanSummary}
          </span>
          {humanEvent && (
            <span className="ml-2 text-xs opacity-60">
              saved {new Date(humanEvent.created_at).toLocaleString()}
            </span>
          )}
        </p>
      )}

      {expanded && (
        <div className="mt-3 space-y-3">
          {loading && <p className="text-xs opacity-60">Loading residence imagery…</p>}
          {error && (
            <p className="rounded border border-red-400/40 bg-red-500/10 px-2 py-1 text-xs text-red-100">
              {error}
            </p>
          )}

          {context && (
            <>
              <p className="text-xs opacity-80">{context.address ?? 'No usable address on file.'}</p>
              <div className="flex flex-wrap gap-2">
                {context.maps_search_url && (
                  <a
                    href={context.maps_search_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-xs hover:bg-white/5"
                  >
                    Open map
                  </a>
                )}
                {context.street_view_url && (
                  <a
                    href={context.street_view_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-xs hover:bg-white/5"
                  >
                    Open Street View
                  </a>
                )}
              </div>

              {context.street_view.image_data_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- src is a data URL; next/image cannot optimize it
                <img
                  src={context.street_view.image_data_url}
                  alt="Street View of voter residence"
                  className="max-h-56 w-full rounded-lg border border-white/10 object-cover"
                />
              ) : (
                <p className="text-xs opacity-60">
                  {context.street_view.error_message ??
                    'No Street View imagery within ~50m of this address.'}
                </p>
              )}

              <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end">
                <label className="text-xs opacity-70">
                  Your estimate
                  <select
                    value={lean}
                    onChange={(e) => setLean(e.target.value as LeanLabel)}
                    className="mt-1 block w-full rounded-lg border bg-black/25 px-2 py-1.5 text-sm"
                  >
                    {LEAN_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs opacity-70">
                  Note (optional)
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Visible cues, uncertainty, etc."
                    className="mt-1 block w-full rounded-lg border bg-black/25 px-2 py-1.5 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void saveGuess()}
                  disabled={saving}
                  className="rounded-lg border border-violet-300/50 bg-violet-500/15 px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save human estimate'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}