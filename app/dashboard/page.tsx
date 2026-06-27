'use client';

import { signOut, useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Branding = 'matrix' | 'red' | 'blue';

type Upload = {
  id: string;
  filename: string;
  row_count: number;
  status: string;
  history_filename?: string | null;
  ballot_favors?: string | null;
  created_at: string;
  job_id?: string | null;
  job_status?: string | null;
  processed_count?: number | null;
  failed_count?: number | null;
  job_total_count?: number | null;
};

type BallotFavors = 'south' | 'north';

type Job = {
  id: string;
  status: string;
  processed_count: number;
  failed_count: number;
  total_count: number;
  error_message?: string | null;
};

type LeanResult = {
  voter_hash: string;
  lean: string;
  confidence: number;
  turnout_propensity?: string;
  turnout_score?: number;
  primary_engagement?: string;
  opposition_mobilization_score?: number;
  evidence: string[];
  raw_data?: { name?: { full?: string }; residence?: { city?: string } };
};

type ResultsPreviewSort = 'opposition' | 'confidence' | 'lean' | 'name' | 'turnout';

const PREVIEW_ROW_OPTIONS = [100, 250, 500] as const;

const TURNOUT_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

const SORT_LABELS: Record<ResultsPreviewSort, string> = {
  opposition: 'opposition score',
  confidence: 'confidence',
  lean: 'lean',
  name: 'name',
  turnout: 'turnout',
};

const themeClass: Record<Branding, string> = {
  matrix: 'theme-matrix',
  red: 'theme-red',
  blue: 'theme-blue',
};

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const [branding, setBranding] = useState<Branding>('matrix');
  const [file, setFile] = useState<File | null>(null);
  const [historyFile, setHistoryFile] = useState<File | null>(null);
  const [ballotFavors, setBallotFavors] = useState<BallotFavors>('south');
  const [previewSort, setPreviewSort] = useState<ResultsPreviewSort>('opposition');
  const [previewRowLimit, setPreviewRowLimit] = useState<number | 'all'>(100);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [results, setResults] = useState<LeanResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [historyDragActive, setHistoryDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyInputRef = useRef<HTMLInputElement>(null);

  const isHistoryFilename = (name: string) => /_H_/i.test(name);

  const setSelectedFile = (next: File | null) => {
    setFile(next);
    setMessage(null);
  };

  const setSelectedHistoryFile = (next: File | null) => {
    setHistoryFile(next);
    setMessage(null);
  };

  const handleRegistrationDrop = (dropped: File) => {
    if (isHistoryFilename(dropped.name)) {
      setSelectedHistoryFile(dropped);
      return;
    }
    setSelectedFile(dropped);
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const refreshUploads = useCallback(async () => {
    const res = await fetch('/api/uploads');
    if (!res.ok) return;
    const data = await res.json();
    setUploads(data.uploads ?? []);
  }, []);

  const refreshJob = useCallback(async (uploadId: string) => {
    const res = await fetch(`/api/uploads/${uploadId}/job`);
    if (!res.ok) return;
    const data = await res.json();
    setJob(data.job ?? null);
  }, []);

  const refreshResults = useCallback(async (uploadId: string) => {
    const res = await fetch(`/api/results/${uploadId}`);
    if (!res.ok) return;
    const data = await res.json();
    setResults(data.results ?? []);
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      refreshUploads();
    }
  }, [status, refreshUploads]);

  useEffect(() => {
    if (!selectedUploadId) return;
    refreshJob(selectedUploadId);
    refreshResults(selectedUploadId);
  }, [selectedUploadId, refreshJob, refreshResults]);

  useEffect(() => {
    if (!selectedUploadId || !job) return;
    if (job.status !== 'queued' && job.status !== 'running') return;

    const timer = setInterval(() => {
      refreshJob(selectedUploadId);
      refreshResults(selectedUploadId);
      refreshUploads();
    }, 1500);

    return () => clearInterval(timer);
  }, [selectedUploadId, job, refreshJob, refreshResults, refreshUploads]);

  const selectedUpload = useMemo(
    () => uploads.find((u) => u.id === selectedUploadId) ?? null,
    [uploads, selectedUploadId],
  );

  const jobIsComplete =
    job?.status === 'completed' || selectedUpload?.job_status === 'completed';

  useEffect(() => {
    if (!selectedUploadId || !jobIsComplete) return;
    refreshResults(selectedUploadId);
  }, [selectedUploadId, jobIsComplete, refreshResults]);

  const displayResults = useMemo(() => {
    const rows = [...results];
    switch (previewSort) {
      case 'confidence':
        return rows.sort((a, b) => b.confidence - a.confidence);
      case 'lean':
        return rows.sort((a, b) => a.lean.localeCompare(b.lean));
      case 'name':
        return rows.sort((a, b) =>
          (a.raw_data?.name?.full ?? '').localeCompare(b.raw_data?.name?.full ?? ''),
        );
      case 'turnout':
        return rows.sort(
          (a, b) =>
            (TURNOUT_RANK[b.turnout_propensity ?? ''] ?? 0) -
              (TURNOUT_RANK[a.turnout_propensity ?? ''] ?? 0) ||
            (b.turnout_score ?? 0) - (a.turnout_score ?? 0),
        );
      case 'opposition':
      default:
        return rows.sort(
          (a, b) =>
            (b.opposition_mobilization_score ?? 0) - (a.opposition_mobilization_score ?? 0),
        );
    }
  }, [results, previewSort]);

  const visiblePreviewRows = useMemo(() => {
    if (previewRowLimit === 'all') return displayResults;
    return displayResults.slice(0, previewRowLimit);
  }, [displayResults, previewRowLimit]);

  const progressPct = useMemo(() => {
    if (!job?.total_count) return 0;
    return Math.round(((job.processed_count + job.failed_count) / job.total_count) * 100);
  }, [job]);

  function jobSummary(upload: Upload): string {
    if (!upload.job_status) return 'No job yet';
    const done = upload.processed_count ?? 0;
    const failed = upload.failed_count ?? 0;
    const total = upload.job_total_count ?? upload.row_count;
    return `Job ${upload.job_status}: ${done} done, ${failed} failed, ${total} total`;
  }

  const handleUpload = async () => {
    if (!file) {
      openFilePicker();
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('ballotFavors', ballotFavors);
      if (historyFile) form.append('historyFile', historyFile);
      const res = await fetch('/api/uploads', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      const historyNote = data.historyAttached
        ? ` History attached (${data.votersWithHistory} voters matched).`
        : '';
      setMessage(
        `Uploaded ${data.rowCount} NPA active voters.${historyNote} Ballot favors ${data.ballotFavors}.`,
      );
      setSelectedUploadId(data.uploadId);
      await refreshUploads();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRun = async () => {
    if (!selectedUploadId) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/uploads/${selectedUploadId}/run`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to start job');
      setMessage(`Job started (${data.jobId}).`);
      await refreshJob(selectedUploadId);
      await refreshResults(selectedUploadId);
      await refreshUploads();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to start job');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelJob = async () => {
    const jobId = job?.id ?? selectedUpload?.job_id;
    if (!jobId) return;
    if (
      !window.confirm(
        'Cancel this job? In-progress rows will reset to pending. You can run again afterward.',
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to cancel job');
      setMessage('Job cancelled.');
      if (selectedUploadId) {
        await refreshJob(selectedUploadId);
        await refreshResults(selectedUploadId);
      }
      await refreshUploads();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to cancel job');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUpload = async () => {
    if (!selectedUploadId || !selectedUpload) return;
    if (
      !window.confirm(
        `Delete "${selectedUpload.filename}" and all its results? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/uploads/${selectedUploadId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to delete upload');
      setMessage(`Deleted ${data.filename}.`);
      setSelectedUploadId(null);
      setJob(null);
      setResults([]);
      await refreshUploads();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete upload');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') {
    return <main className="min-h-screen p-8">Loading...</main>;
  }

  if (status !== 'authenticated') {
    return (
      <main className="min-h-screen p-8">
        <p>Please sign in.</p>
      </main>
    );
  }

  return (
    <main className={`min-h-screen p-6 md:p-10 ${themeClass[branding]}`}>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">LeanLink NPA FL Dashboard</h1>
            <p className="text-sm opacity-80">{session?.user?.email}</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="rounded-lg border px-4 py-2 text-sm hover:opacity-80"
          >
            Sign out
          </button>
        </header>

        <div className="flex flex-wrap gap-2">
          {(['matrix', 'red', 'blue'] as Branding[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setBranding(mode)}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                branding === mode ? 'bg-white/20' : 'bg-black/20'
              }`}
            >
              {mode === 'matrix' ? 'Matrix' : mode === 'red' ? 'Red' : 'Blue'}
            </button>
          ))}
        </div>

        <section className="panel rounded-2xl p-6">
          <h2 className="mb-4 text-xl font-semibold">Upload Florida Voter Extract (.txt)</h2>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,text/plain"
            className="hidden"
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={openFilePicker}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFilePicker();
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) handleRegistrationDrop(dropped);
            }}
            className={`mb-4 cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
              dragActive
                ? 'border-emerald-400 bg-emerald-500/10'
                : 'border-white/30 bg-black/10 hover:border-white/50 hover:bg-black/20'
            }`}
          >
            <p className="text-lg font-medium">
              {file ? file.name : 'Click to choose a file or drag it here'}
            </p>
            <p className="mt-2 text-sm opacity-75">
              Florida registration extract · e.g. CAL_20250812.txt
            </p>
          </div>

          <div className="mb-4">
            <h3 className="mb-2 font-medium">Voting history file (recommended)</h3>
            <input
              ref={historyInputRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={(e) => setSelectedHistoryFile(e.target.files?.[0] ?? null)}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => historyInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  historyInputRef.current?.click();
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                setHistoryDragActive(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setHistoryDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setHistoryDragActive(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setHistoryDragActive(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) setSelectedHistoryFile(dropped);
              }}
              className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
                historyDragActive
                  ? 'border-emerald-400 bg-emerald-500/10'
                  : 'border-white/30 bg-black/10 hover:border-white/50 hover:bg-black/20'
              }`}
            >
              <p className="font-medium">
                {historyFile ? historyFile.name : 'Click or drag history file here'}
              </p>
              <p className="mt-2 text-xs opacity-70">
                e.g. CAL_H_20250812.txt — turnout & opposition scores
              </p>
            </div>
            {historyFile && (
              <button
                type="button"
                onClick={() => {
                  setSelectedHistoryFile(null);
                  if (historyInputRef.current) historyInputRef.current.value = '';
                }}
                className="mt-2 text-sm opacity-75 hover:opacity-100"
              >
                Clear history file
              </button>
            )}
            <p className="mt-2 text-xs opacity-60">
              Tip: dropping a *_H_* file on the registration zone above also routes it here.
            </p>
          </div>

          <div className="mb-4">
            <h3 className="mb-2 font-medium">Ballot / contact scenario</h3>
            <p className="mb-2 text-xs opacity-70">
              If outreach favors south, north-leaning voters get higher opposition mobilization scores.
            </p>
            <div className="flex gap-2">
              {(['south', 'north'] as BallotFavors[]).map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => setBallotFavors(side)}
                  className={`rounded-lg px-4 py-2 text-sm ${
                    ballotFavors === side ? 'bg-white/20' : 'bg-black/20'
                  }`}
                >
                  Favors {side}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleUpload}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? 'Uploading…' : file ? 'Upload & Ingest' : 'Choose File'}
            </button>
            {file && (
              <button
                onClick={() => {
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                disabled={busy}
                className="rounded-lg border px-4 py-2.5 text-sm hover:opacity-80 disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          <p className="mt-3 text-sm opacity-75">
            Filters to NPA + Active voters automatically.
          </p>
        </section>

        <section className="panel rounded-2xl p-6">
          <h2 className="mb-2 text-xl font-semibold">Uploads</h2>
          <p className="mb-4 text-sm opacity-75">
            Each row is one ingest (registration file + optional history). Select one to run or
            export — jobs are per upload, not shared.
          </p>
          <div className="space-y-2">
            {uploads.map((upload) => (
              <button
                key={upload.id}
                onClick={() => setSelectedUploadId(upload.id)}
                className={`block w-full rounded-lg border px-4 py-3 text-left ${
                  selectedUploadId === upload.id ? 'bg-white/15 ring-1 ring-white/30' : 'bg-black/10'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{upload.filename}</div>
                  {upload.job_status && (
                    <span className="rounded-full bg-black/30 px-2 py-0.5 text-xs uppercase tracking-wide">
                      {upload.job_status}
                    </span>
                  )}
                </div>
                <div className="text-sm opacity-80">
                  {upload.row_count} voters · upload {upload.status}
                  {upload.history_filename ? ` · + ${upload.history_filename}` : ' · no history file'}
                  {upload.ballot_favors ? ` · favors ${upload.ballot_favors}` : ''}
                </div>
                <div className="mt-1 text-xs opacity-70">{jobSummary(upload)}</div>
                <div className="text-xs opacity-60">
                  {new Date(upload.created_at).toLocaleString()}
                </div>
              </button>
            ))}
            {uploads.length === 0 && <p className="text-sm opacity-75">No uploads yet.</p>}
          </div>
        </section>

        {selectedUploadId && selectedUpload && (
          <section className="panel rounded-2xl p-6 space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Analyze selected upload</h2>
              <p className="mt-1 text-sm opacity-80">
                <span className="font-medium">{selectedUpload.filename}</span>
                {selectedUpload.history_filename
                  ? ` with ${selectedUpload.history_filename}`
                  : ' (no history — turnout/opposition scores will be limited)'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleRun}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-5 py-2.5 text-white disabled:opacity-50"
              >
                {selectedUpload.job_status === 'completed'
                  ? 'Re-run Analysis Job'
                  : selectedUpload.job_status === 'running' ||
                      selectedUpload.job_status === 'queued'
                    ? 'Retry / resume worker'
                    : 'Run Analysis Job'}
              </button>
              <a
                href={`/api/export/${selectedUploadId}?format=csv`}
                className="rounded-lg border px-4 py-2 text-sm hover:opacity-80"
              >
                Export CSV
              </a>
              <a
                href={`/api/export/${selectedUploadId}?format=json`}
                className="rounded-lg border px-4 py-2 text-sm hover:opacity-80"
              >
                Export JSON
              </a>
              {(selectedUpload.job_status === 'running' ||
                selectedUpload.job_status === 'queued') && (
                <button
                  onClick={handleCancelJob}
                  disabled={busy}
                  className="rounded-lg border border-amber-400/60 px-4 py-2 text-sm text-amber-100 hover:opacity-80 disabled:opacity-50"
                >
                  Cancel job
                </button>
              )}
              <button
                onClick={handleDeleteUpload}
                disabled={busy}
                className="rounded-lg border border-red-400/50 px-4 py-2 text-sm text-red-100 hover:opacity-80 disabled:opacity-50"
              >
                Delete upload
              </button>
            </div>

            {job && (
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span>
                    This upload&apos;s job: {job.status} · {job.processed_count} done ·{' '}
                    {job.failed_count} failed · {job.total_count} total
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-black/30">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </section>
        )}

        {jobIsComplete && (
          <section className="panel rounded-2xl p-6 overflow-x-auto">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  Results preview
                  {results.length > 0 ? ` (${results.length} loaded)` : ' (loading…)'}
                </h2>
                <p className="mt-1 text-xs opacity-70">
                  {results.length > 0
                    ? `All ${results.length} rows loaded in your browser. The table below shows a subset — change "Show" to see more. Sort is instant (no re-fetch).`
                    : 'Fetching all rows from the database…'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm opacity-80" htmlFor="preview-sort">
                  Sort by
                </label>
                <select
                  id="preview-sort"
                  value={previewSort}
                  onChange={(e) => setPreviewSort(e.target.value as ResultsPreviewSort)}
                  className="rounded-lg border bg-black/20 px-3 py-1.5 text-sm"
                >
                  <option value="opposition">Opposition score</option>
                  <option value="confidence">Confidence</option>
                  <option value="lean">Lean</option>
                  <option value="name">Name</option>
                  <option value="turnout">Turnout</option>
                </select>
                <label className="text-sm opacity-80" htmlFor="preview-show">
                  Show
                </label>
                <select
                  id="preview-show"
                  value={previewRowLimit === 'all' ? 'all' : String(previewRowLimit)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPreviewRowLimit(v === 'all' ? 'all' : Number(v));
                  }}
                  className="rounded-lg border bg-black/20 px-3 py-1.5 text-sm"
                >
                  {PREVIEW_ROW_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} rows
                    </option>
                  ))}
                  <option value="all">All loaded rows</option>
                </select>
                <button
                  type="button"
                  onClick={() => selectedUploadId && refreshResults(selectedUploadId)}
                  className="rounded-lg border px-3 py-1.5 text-sm hover:opacity-80"
                >
                  Re-fetch data
                </button>
              </div>
            </div>
            {results.length === 0 ? (
              <p className="text-sm opacity-75">
                Job finished — loading results. Click Refresh table or use Export CSV (data is in
                the database).
              </p>
            ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-white/20 text-left">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Lean</th>
                  <th className="py-2 pr-4">Conf.</th>
                  <th className="py-2 pr-4">Turnout</th>
                  <th className="py-2 pr-4">Primary</th>
                  <th className="py-2 pr-4">Opp. score</th>
                </tr>
              </thead>
              <tbody>
                {visiblePreviewRows.map((row) => (
                  <tr key={row.voter_hash} className="border-b border-white/10">
                    <td className="py-2 pr-4">{row.raw_data?.name?.full ?? '—'}</td>
                    <td className="py-2 pr-4">{row.lean}</td>
                    <td className="py-2 pr-4">{row.confidence}</td>
                    <td className="py-2 pr-4">{row.turnout_propensity ?? '—'}</td>
                    <td className="py-2 pr-4">{row.primary_engagement ?? '—'}</td>
                    <td className="py-2 pr-4">{row.opposition_mobilization_score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
            {results.length > 0 && (
              <p className="mt-3 text-xs opacity-70">
                Table: {visiblePreviewRows.length} of {results.length} loaded rows · sorted by{' '}
                {SORT_LABELS[previewSort]}.
                {visiblePreviewRows.length < results.length
                  ? ' Choose "All loaded rows" above to see every row in the browser, or Export CSV.'
                  : ' Export CSV for a spreadsheet copy.'}
              </p>
            )}
          </section>
        )}

        {message && <p className="text-sm opacity-90">{message}</p>}

        <footer className="text-xs opacity-60">
          Legal disclaimer placeholder — for authorized political intelligence use only.
        </footer>
      </div>
    </main>
  );
}