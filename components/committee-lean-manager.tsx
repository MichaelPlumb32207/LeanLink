'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LeanLabel } from '@/lib/enrichment/types';

type CommitteeRow = {
  committee_name: string;
  committee_name_norm: string;
  npa_voter_count: number;
  sample_row_index: number | null;
  labeled: boolean;
  lean: string | null;
};

const LEAN_OPTIONS: LeanLabel[] = ['Left', 'Right', 'Independent'];

type CommitteeDraft = { lean: LeanLabel | ''; notes: string };

export function CommitteeLeanManager({
  uploadId,
  open,
  onClose,
}: {
  uploadId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [uncertain, setUncertain] = useState<CommitteeRow[]>([]);
  const [labeled, setLabeled] = useState<CommitteeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CommitteeDraft>>({});
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [patternStats, setPatternStats] = useState<{
    source: string;
    total: number;
    invalid: number;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!uploadId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ uploadId });
      const res = await fetch(`/api/committee-lean?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.hint].filter(Boolean).join(' — '));
      setUncertain(data.uncertain ?? []);
      setLabeled(data.labeled ?? []);
      setPatternStats(data.patterns ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [uploadId]);

  useEffect(() => {
    if (open && uploadId) void refresh();
  }, [open, uploadId, refresh]);

  const saveLabel = async (committeeName: string) => {
    const draft = drafts[committeeName] ?? { lean: '', notes: '' };
    if (!draft.lean) {
      setError('Choose a lean before saving.');
      return;
    }
    setSaving(committeeName);
    setError(null);
    setSaveNotice(null);
    try {
      const res = await fetch('/api/committee-lean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          committee_name: committeeName,
          lean: draft.lean,
          notes: draft.notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.hint].filter(Boolean).join(' — '));
      setUncertain(data.queue?.uncertain ?? []);
      setLabeled(data.queue?.labeled ?? []);
      const n = data.refusion?.voters_refused ?? 0;
      setSaveNotice(
        n > 0
          ? `Saved — re-fused ${n} voter${n === 1 ? '' : 's'} across all uploads (no re-run needed).`
          : 'Saved — label stored for future FL contrib matches (no voters to re-fuse yet).',
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[committeeName];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="panel max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-white/15 shadow-xl flex flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Committee &amp; entity lean</h2>
            <p className="mt-1 text-sm opacity-75">
              Committees the parser could not classify. Labels are <strong>global</strong> (all counties)
              — saving re-fuses matching voters automatically; no pipeline re-run required.
            </p>
            {patternStats && (
              <p className="mt-1 text-xs opacity-60">
                Pattern registry: {patternStats.total} patterns active (
                {patternStats.source === 'db' ? 'DB seed' : 'code fallback'}
                {patternStats.invalid > 0 ? ` · ${patternStats.invalid} invalid skipped` : ''}) —
                edited via SQL for now; editor UI is a planned follow-up.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-3 py-1 text-sm hover:opacity-80"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          {error && (
            <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {error}
            </p>
          )}
          {saveNotice && (
            <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
              {saveNotice}
            </p>
          )}
          {loading && <p className="text-sm opacity-60">Loading…</p>}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-2">
              Needs label ({uncertain.length})
            </h3>
            {uncertain.length === 0 ? (
              <p className="text-sm opacity-60">No uncertain committees for this upload.</p>
            ) : (
              <ul className="space-y-2">
                {uncertain.map((row) => {
                  const draft = drafts[row.committee_name] ?? { lean: '', notes: '' };
                  return (
                    <li
                      key={row.committee_name_norm}
                      className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{row.committee_name}</span>
                        <span className="text-xs opacity-70">
                          {row.npa_voter_count} NPA{row.npa_voter_count === 1 ? '' : 's'}
                          {row.sample_row_index != null ? ` · e.g. row ${row.sample_row_index}` : ''}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 items-end">
                        <select
                          value={draft.lean}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [row.committee_name]: {
                                ...draft,
                                lean: e.target.value as LeanLabel | '',
                              },
                            }))
                          }
                          className="rounded-lg border bg-black/25 px-2 py-1 text-xs"
                        >
                          <option value="">Select lean…</option>
                          {LEAN_OPTIONS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          placeholder="Note (optional)"
                          value={draft.notes}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [row.committee_name]: { ...draft, notes: e.target.value },
                            }))
                          }
                          className="min-w-[10rem] flex-1 rounded-lg border bg-black/25 px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          disabled={saving === row.committee_name || !draft.lean}
                          onClick={() => void saveLabel(row.committee_name)}
                          className="rounded-lg border border-violet-300/50 bg-violet-500/15 px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                        >
                          {saving === row.committee_name ? 'Saving…' : 'Save label'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {labeled.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-2">
                Researcher-labeled ({labeled.length})
              </h3>
              <ul className="space-y-1 text-sm">
                {labeled.map((row) => (
                  <li
                    key={row.committee_name_norm}
                    className="flex flex-wrap justify-between gap-2 rounded border border-white/5 px-2 py-1 opacity-80"
                  >
                    <span>{row.committee_name}</span>
                    <span>
                      {row.lean}
                      {row.npa_voter_count > 0 ? ` · ${row.npa_voter_count} NPAs` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}