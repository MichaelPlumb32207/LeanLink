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
};

type BallotFavors = 'south' | 'north';

type Job = {
  id: string;
  status: string;
  processed_count: number;
  failed_count: number;
  total_count: number;
};

type LeanResult = {
  voter_hash: string;
  lean: string;
  confidence: number;
  turnout_propensity?: string;
  primary_engagement?: string;
  opposition_mobilization_score?: number;
  evidence: string[];
  raw_data?: { name?: { full?: string }; residence?: { city?: string } };
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
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [results, setResults] = useState<LeanResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyInputRef = useRef<HTMLInputElement>(null);

  const setSelectedFile = (next: File | null) => {
    setFile(next);
    setMessage(null);
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
    }, 3000);

    return () => clearInterval(timer);
  }, [selectedUploadId, job, refreshJob, refreshResults, refreshUploads]);

  const progressPct = useMemo(() => {
    if (!job?.total_count) return 0;
    return Math.round(((job.processed_count + job.failed_count) / job.total_count) * 100);
  }, [job]);

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
      await refreshUploads();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to start job');
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
              if (dropped) setSelectedFile(dropped);
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

          <div className="mb-4 rounded-xl border border-white/20 bg-black/10 p-4">
            <h3 className="mb-2 font-medium">Voting history file (recommended)</h3>
            <input
              ref={historyInputRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={(e) => setHistoryFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => historyInputRef.current?.click()}
                className="rounded-lg border px-4 py-2 text-sm hover:opacity-80"
              >
                {historyFile ? historyFile.name : 'Choose history file'}
              </button>
              {historyFile && (
                <button
                  type="button"
                  onClick={() => {
                    setHistoryFile(null);
                    if (historyInputRef.current) historyInputRef.current.value = '';
                  }}
                  className="text-sm opacity-75 hover:opacity-100"
                >
                  Clear history
                </button>
              )}
            </div>
            <p className="mt-2 text-xs opacity-70">e.g. CAL_H_20250812.txt — powers turnout & opposition scores</p>
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
          <h2 className="mb-4 text-xl font-semibold">Uploads</h2>
          <div className="space-y-2">
            {uploads.map((upload) => (
              <button
                key={upload.id}
                onClick={() => setSelectedUploadId(upload.id)}
                className={`block w-full rounded-lg border px-4 py-3 text-left ${
                  selectedUploadId === upload.id ? 'bg-white/15' : 'bg-black/10'
                }`}
              >
                <div className="font-medium">{upload.filename}</div>
                <div className="text-sm opacity-80">
                  {upload.row_count} rows · {upload.status}
                  {upload.history_filename ? ` · history: ${upload.history_filename}` : ''}
                  {upload.ballot_favors ? ` · ballot favors ${upload.ballot_favors}` : ''} ·{' '}
                  {new Date(upload.created_at).toLocaleString()}
                </div>
              </button>
            ))}
            {uploads.length === 0 && <p className="text-sm opacity-75">No uploads yet.</p>}
          </div>
        </section>

        {selectedUploadId && (
          <section className="panel rounded-2xl p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleRun}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-5 py-2.5 text-white disabled:opacity-50"
              >
                Run Analysis Job
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
            </div>

            {job && (
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span>
                    Job {job.status} · {job.processed_count} done · {job.failed_count} failed ·{' '}
                    {job.total_count} total
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

        {results.length > 0 && (
          <section className="panel rounded-2xl p-6 overflow-x-auto">
            <h2 className="mb-4 text-xl font-semibold">Results ({results.length})</h2>
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
                {results.slice(0, 100).map((row) => (
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