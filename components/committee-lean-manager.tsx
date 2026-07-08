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
  source: string | null;
  confidence: number | null;
  notes: string | null;
  updated_at: string | null;
};

type PendingRefusion = { voters_pending: number; committees_pending: number };

const LEAN_OPTIONS: LeanLabel[] = ['Left', 'Right', 'Independent'];

type CommitteeDraft = { lean: LeanLabel | ''; notes: string };

export function CommitteeLeanManager({
  uploadId,
  open,
  onClose,
  onStarted,
}: {
  uploadId: string | null;
  open: boolean;
  onClose: () => void;
  /** Fired when a background re-fusion is kicked off, so the page refreshes the
   *  summary and the run appears in the box score without waiting for a poll. */
  onStarted?: () => void;
}) {
  const [uncertain, setUncertain] = useState<CommitteeRow[]>([]);
  const [labeled, setLabeled] = useState<CommitteeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [refusing, setRefusing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CommitteeDraft>>({});
  const [editDrafts, setEditDrafts] = useState<Record<string, LeanLabel>>({});
  const [pending, setPending] = useState<PendingRefusion | null>(null);
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
      setPending(data.pending ?? null);
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
      setPending(data.pending ?? null);
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

  // Edit an existing label's lean (reuses the save path → re-fuses AND reclaims
  // source='researcher', locking the committee against the agent classifier).
  const editLabel = async (committeeName: string) => {
    const newLean = editDrafts[committeeName];
    if (!newLean) return;
    setSaving(committeeName);
    setError(null);
    setSaveNotice(null);
    try {
      const res = await fetch('/api/committee-lean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ committee_name: committeeName, lean: newLean, upload_id: uploadId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.hint].filter(Boolean).join(' — '));
      setUncertain(data.queue?.uncertain ?? []);
      setLabeled(data.queue?.labeled ?? []);
      setPending(data.pending ?? null);
      const n = data.refusion?.voters_refused ?? 0;
      setSaveNotice(`Updated to ${newLean} (now researcher-locked)${n > 0 ? ` — re-fused ${n} voter${n === 1 ? '' : 's'}` : ''}.`);
      setEditDrafts((prev) => {
        const next = { ...prev };
        delete next[committeeName];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(null);
    }
  };

  const deleteLabel = async (committeeName: string) => {
    if (!confirm(`Remove the label for "${committeeName}"? Affected voters revert to their pattern lean / Undetermined.`)) return;
    setDeleting(committeeName);
    setError(null);
    setSaveNotice(null);
    try {
      const params = new URLSearchParams({ committee_name: committeeName });
      if (uploadId) params.set('uploadId', uploadId);
      const res = await fetch(`/api/committee-lean?${params}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Delete failed');
      setUncertain(data.queue?.uncertain ?? []);
      setLabeled(data.queue?.labeled ?? []);
      setPending(data.pending ?? null);
      const n = data.refusion?.voters_refused ?? 0;
      setSaveNotice(`Removed label${n > 0 ? ` — reverted ${n} voter${n === 1 ? '' : 's'}` : ''}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  const refuseAll = async () => {
    setRefusing(true);
    setError(null);
    setSaveNotice(null);
    try {
      const res = await fetch('/api/committee-lean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refuse_all', upload_id: uploadId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Re-fuse failed');
      if (data.started) {
        const n = data.voters_pending ?? 0;
        setSaveNotice(
          `Re-fusion started — booking ${n} voter${n === 1 ? '' : 's'} in the background. Watch progress in the box score above.`,
        );
        onStarted?.();
      } else if (data.alreadyRunning) {
        setSaveNotice('Re-fusion is already running — watch its progress in the box score above.');
      } else {
        setSaveNotice('Nothing pending to re-fuse.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-fuse failed');
    } finally {
      setRefusing(false);
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
          {loading && uncertain.length === 0 && labeled.length === 0 && (
            <p className="text-sm opacity-60">Loading committees…</p>
          )}

          {pending && pending.voters_pending > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-300/40 bg-violet-500/10 px-3 py-2 text-sm">
              <span>
                <b>{pending.voters_pending.toLocaleString()}</b> voter
                {pending.voters_pending === 1 ? '' : 's'} behind{' '}
                <b>{pending.committees_pending}</b> labeled committee
                {pending.committees_pending === 1 ? '' : 's'} are still Undetermined and eligible —
                a label exists but they haven&apos;t been re-fused.
              </span>
              <button
                type="button"
                onClick={() => void refuseAll()}
                disabled={refusing}
                className="rounded-lg border border-violet-300/60 bg-violet-500/20 px-3 py-1 text-xs font-medium disabled:opacity-50"
              >
                {refusing ? 'Re-fusing…' : 'Re-fuse now'}
              </button>
            </div>
          )}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-2">
              Needs label ({uncertain.length})
            </h3>
            {!loading && uncertain.length === 0 ? (
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
                Labeled ({labeled.length}) — review &amp; override
              </h3>
              <ul className="space-y-2 text-sm">
                {labeled.map((row) => {
                  const isAgent = row.source === 'agent';
                  const edit = editDrafts[row.committee_name];
                  return (
                    <li
                      key={row.committee_name_norm}
                      className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{row.committee_name}</span>
                        <span className="flex items-center gap-1.5 text-xs">
                          <span
                            className={`rounded-full px-1.5 py-0.5 ${
                              isAgent
                                ? 'border border-amber-300/50 bg-amber-500/15 text-amber-200'
                                : 'border border-emerald-300/50 bg-emerald-500/15 text-emerald-200'
                            }`}
                          >
                            {isAgent ? 'Grok' : row.source === 'import' ? 'Imported' : 'Researcher'}
                          </span>
                          <span className="opacity-70">
                            {row.lean}
                            {row.confidence != null ? ` · ${row.confidence}%` : ''}
                            {row.npa_voter_count > 0 ? ` · ${row.npa_voter_count} NPAs` : ''}
                          </span>
                        </span>
                      </div>
                      {row.notes && <p className="mt-1 text-xs opacity-55">{row.notes}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select
                          value={edit ?? ''}
                          onChange={(e) =>
                            setEditDrafts((prev) => ({
                              ...prev,
                              [row.committee_name]: e.target.value as LeanLabel,
                            }))
                          }
                          className="rounded-lg border bg-black/25 px-2 py-1 text-xs"
                        >
                          <option value="">Change lean…</option>
                          {LEAN_OPTIONS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={saving === row.committee_name || !edit || edit === row.lean}
                          onClick={() => void editLabel(row.committee_name)}
                          className="rounded-lg border border-violet-300/50 bg-violet-500/15 px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                        >
                          {saving === row.committee_name ? 'Saving…' : isAgent ? 'Override + lock' : 'Update'}
                        </button>
                        <button
                          type="button"
                          disabled={deleting === row.committee_name}
                          onClick={() => void deleteLabel(row.committee_name)}
                          className="rounded-lg border border-red-300/40 bg-red-500/10 px-2.5 py-1 text-xs text-red-100 disabled:opacity-40"
                        >
                          {deleting === row.committee_name ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}