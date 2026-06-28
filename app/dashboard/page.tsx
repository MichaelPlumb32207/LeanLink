'use client';

import { signOut, useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyClientFilters,
  buildResultsQueryString,
  EMPTY_COLUMN_FILTERS,
  hasActiveFilters,
  type ColumnFilters,
  type LeanResultRow,
  type SortColumn,
  type SortDirection,
  shouldUseServerQuery,
  shouldUseServerSort,
  SORT_COLUMN_LABELS,
  sortResultRows,
} from '@/lib/results-query';
import { ENRICHMENT_MODES, type EnrichmentMode } from '@/lib/enrichment/modes';
import type { EnrichmentScorecard } from '@/lib/enrichment/scorecard';
import { suggestedTestRowsForFilename } from '@/lib/enrichment/suggested-test-rows';
import { formatRowIndices, parseRowIndicesInput } from '@/lib/test-row-indices';

type AnalyzeTest = 'enrichment' | 'scorecard' | 'street-view' | 'fec' | 'fec-sweep';

type FecSweepJob = {
  id: string;
  status: string;
  processed_count: number;
  failed_count: number;
  hits_count: number;
  total_count: number;
  error_message?: string | null;
};

const ANALYZE_TEST_OPTIONS: {
  id: AnalyzeTest;
  label: string;
  description: string;
  needsMode: boolean;
  multiRow: boolean;
  wholeUpload?: boolean;
}[] = [
  {
    id: 'enrichment',
    label: 'Test enrichment',
    description: 'Single voter — full OSINT JSON, citations, and cost.',
    needsMode: true,
    multiRow: false,
  },
  {
    id: 'scorecard',
    label: 'Scorecard',
    description: 'All rows in subset — identity, social, lean metrics and per-row table.',
    needsMode: true,
    multiRow: true,
  },
  {
    id: 'street-view',
    label: 'Street View',
    description: 'Exploratory vision at residence — separate research arm, not OSINT lean.',
    needsMode: false,
    multiRow: false,
  },
  {
    id: 'fec',
    label: 'FEC contributor lookup (subset)',
    description: 'Direct FEC Open API Schedule A on test subset only (no Grok).',
    needsMode: false,
    multiRow: true,
  },
  {
    id: 'fec-sweep',
    label: 'FEC sweep (whole file)',
    description: 'All voters in upload — free throttled FEC API, results stored in DB.',
    needsMode: false,
    multiRow: true,
    wholeUpload: true,
  },
];

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

type LeanResult = LeanResultRow;

const PREVIEW_ROW_OPTIONS = [100, 250, 500] as const;

const LEAN_OPTIONS = ['', 'Left', 'Right', 'Independent', 'Undetermined'] as const;
const TURNOUT_OPTIONS = ['', 'High', 'Medium', 'Low'] as const;

function shortHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

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
  const [sortColumn, setSortColumn] = useState<SortColumn>('opposition');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(EMPTY_COLUMN_FILTERS);
  const [previewRowLimit, setPreviewRowLimit] = useState<number | 'all'>(100);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [results, setResults] = useState<LeanResult[]>([]);
  const [resultsTotal, setResultsTotal] = useState(0);
  const [resultsFiltered, setResultsFiltered] = useState(0);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [revealedVoterHash, setRevealedVoterHash] = useState<string | null>(null);
  const [testRowIndicesInput, setTestRowIndicesInput] = useState('');
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [analyzeTest, setAnalyzeTest] = useState<AnalyzeTest>('enrichment');
  const [analyzeMode, setAnalyzeMode] = useState<EnrichmentMode>('grok-full');
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [analyzeOutputJson, setAnalyzeOutputJson] = useState<string | null>(null);
  const [analyzeUrls, setAnalyzeUrls] = useState<string[]>([]);
  const [analyzeCost, setAnalyzeCost] = useState<string | null>(null);
  const [analyzeScorecard, setAnalyzeScorecard] = useState<EnrichmentScorecard | null>(null);
  const [analyzeStreetViewPreview, setAnalyzeStreetViewPreview] = useState<string | null>(null);
  const [fecSweepJob, setFecSweepJob] = useState<FecSweepJob | null>(null);
  const [fecSweepHitRate, setFecSweepHitRate] = useState<number | null>(null);
  const [fecSweepSampleHits, setFecSweepSampleHits] = useState<
    { row_index: number; contributor_name: string; match_level: string; result_count: number }[]
  >([]);
  const [fecSweepLastUpdated, setFecSweepLastUpdated] = useState<Date | null>(null);
  const [analyzeNotice, setAnalyzeNotice] = useState<{
    tone: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);
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

  const refreshFecSweep = useCallback(async (uploadId: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/uploads/${uploadId}/fec-sweep`);
      const data = await res.json();
      if (!res.ok) {
        const err = [data.error, data.hint].filter(Boolean).join(' — ');
        return err || 'Failed to load FEC sweep status';
      }
      setFecSweepJob(data.job ?? null);
      setFecSweepHitRate(typeof data.hit_rate_pct === 'number' ? data.hit_rate_pct : null);
      setFecSweepSampleHits(Array.isArray(data.sample_hits) ? data.sample_hits : []);
      setFecSweepLastUpdated(new Date());
      return null;
    } catch {
      return 'Network error loading FEC sweep status';
    }
  }, []);

  const refreshResults = useCallback(
    async (uploadId: string, uploadRowCount: number) => {
      const serverQuery = shouldUseServerQuery(uploadRowCount, columnFilters);
      const serverSort = shouldUseServerSort(uploadRowCount);

      let url = `/api/results/${uploadId}`;
      if (serverQuery || serverSort) {
        const limit =
          previewRowLimit === 'all'
            ? Math.min(uploadRowCount, 10000)
            : previewRowLimit;
        url += `?${buildResultsQueryString({
          sortColumn,
          sortDirection,
          filters: serverQuery ? columnFilters : EMPTY_COLUMN_FILTERS,
          limit,
        })}`;
      } else {
        url += `?limit=10000&sort=${sortColumn}&order=${sortDirection}`;
      }

      setResultsLoading(true);
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        setResults(data.results ?? []);
        setResultsTotal(data.total ?? data.results?.length ?? 0);
        setResultsFiltered(data.filtered ?? data.results?.length ?? 0);
      } finally {
        setResultsLoading(false);
      }
    },
    [columnFilters, previewRowLimit, sortColumn, sortDirection],
  );

  useEffect(() => {
    if (status === 'authenticated') {
      refreshUploads();
    }
  }, [status, refreshUploads]);

  const selectedUpload = useMemo(
    () => uploads.find((u) => u.id === selectedUploadId) ?? null,
    [uploads, selectedUploadId],
  );

  const suggestedTestRows = useMemo(
    () => suggestedTestRowsForFilename(selectedUpload?.filename),
    [selectedUpload?.filename],
  );

  const parsedTestRowIndices = useMemo(
    () => parseRowIndicesInput(testRowIndicesInput),
    [testRowIndicesInput],
  );

  const activeAnalyzeTest = ANALYZE_TEST_OPTIONS.find((t) => t.id === analyzeTest)!;

  useEffect(() => {
    if (!selectedUploadId || suggestedTestRows.length === 0) return;
    const defaults = suggestedTestRows.map((r) => r.rowIndex);
    setTestRowIndicesInput(formatRowIndices(defaults));
    setActiveRowIndex(defaults[0]);
    setAnalyzeScorecard(null);
    setAnalyzeOutputJson(null);
    setAnalyzeUrls([]);
    setAnalyzeCost(null);
    setAnalyzeStreetViewPreview(null);
  }, [selectedUploadId, suggestedTestRows]);

  useEffect(() => {
    if (parsedTestRowIndices.length === 0) return;
    if (!parsedTestRowIndices.includes(activeRowIndex)) {
      setActiveRowIndex(parsedTestRowIndices[0]);
    }
  }, [parsedTestRowIndices, activeRowIndex]);

  const selectedUploadRowCount = selectedUpload?.row_count ?? 0;
  const serverQuery = shouldUseServerQuery(selectedUploadRowCount, columnFilters);
  const serverSort = shouldUseServerSort(selectedUploadRowCount);
  const useServerFetch = serverQuery || serverSort;

  const jobIsComplete =
    job?.status === 'completed' || selectedUpload?.job_status === 'completed';

  useEffect(() => {
    if (!selectedUploadId) return;
    setSortColumn('opposition');
    setSortDirection('desc');
    setColumnFilters(EMPTY_COLUMN_FILTERS);
    setRevealedVoterHash(null);
    refreshJob(selectedUploadId);
    refreshFecSweep(selectedUploadId);
  }, [selectedUploadId, refreshJob, refreshFecSweep]);

  useEffect(() => {
    if (!selectedUploadId || !selectedUpload) return;

    const debounceMs = hasActiveFilters(columnFilters) ? 300 : 0;
    const timer = setTimeout(() => {
      refreshResults(selectedUploadId, selectedUpload.row_count);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [
    selectedUploadId,
    selectedUpload,
    columnFilters,
    useServerFetch ? sortColumn : '',
    useServerFetch ? sortDirection : '',
    useServerFetch ? previewRowLimit : '',
    jobIsComplete,
    refreshResults,
  ]);

  useEffect(() => {
    if (!selectedUploadId || !job) return;
    if (job.status !== 'queued' && job.status !== 'running') return;

    const timer = setInterval(() => {
      refreshJob(selectedUploadId);
      if (selectedUpload) refreshResults(selectedUploadId, selectedUpload.row_count);
      refreshUploads();
    }, 1500);

    return () => clearInterval(timer);
  }, [selectedUploadId, selectedUpload, job, refreshJob, refreshResults, refreshUploads]);

  const fecSweepIsActive = useMemo(
    () => fecSweepJob?.status === 'queued' || fecSweepJob?.status === 'running',
    [fecSweepJob?.status],
  );

  useEffect(() => {
    if (!selectedUploadId || !fecSweepIsActive) return;

    const poll = () => {
      void refreshFecSweep(selectedUploadId);
    };
    poll();

    const timer = setInterval(poll, 5000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [selectedUploadId, fecSweepIsActive, refreshFecSweep]);

  const fecSweepProgressPct = useMemo(() => {
    if (!fecSweepJob?.total_count) return 0;
    return Math.round((fecSweepJob.processed_count / fecSweepJob.total_count) * 100);
  }, [fecSweepJob]);

  const displayResults = useMemo(() => {
    if (serverQuery || serverSort) return results;
    let rows = applyClientFilters(results, columnFilters);
    rows = sortResultRows(rows, sortColumn, sortDirection);
    return rows;
  }, [results, columnFilters, sortColumn, sortDirection, serverQuery, serverSort]);

  const visiblePreviewRows = useMemo(() => {
    if (serverQuery || serverSort) return displayResults;
    if (previewRowLimit === 'all') return displayResults;
    return displayResults.slice(0, previewRowLimit);
  }, [displayResults, previewRowLimit, serverQuery, serverSort]);

  const handleSortHeader = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection(column === 'name' || column === 'lean' || column === 'primary' ? 'asc' : 'desc');
    }
  };

  const updateFilter = (key: keyof ColumnFilters, value: string) => {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
    setRevealedVoterHash(null);
  };

  const toggleRevealName = (voterHash: string) => {
    setRevealedVoterHash((current) => (current === voterHash ? null : voterHash));
  };

  const sortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) return ' ↕';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

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
        await refreshResults(selectedUploadId, selectedUpload?.row_count ?? 0);
      }
      await refreshUploads();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to cancel job');
    } finally {
      setBusy(false);
    }
  };

  const loadSuggestedTestRows = () => {
    const defaults = suggestedTestRows.map((r) => r.rowIndex);
    setTestRowIndicesInput(formatRowIndices(defaults));
    if (defaults.length > 0) setActiveRowIndex(defaults[0]);
  };

  const handleCancelFecSweep = async () => {
    if (!selectedUploadId) return;
    setAnalyzeBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/uploads/${selectedUploadId}/fec-sweep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to cancel FEC sweep');
      setMessage('FEC sweep cancelled.');
      await refreshFecSweep(selectedUploadId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to cancel FEC sweep');
    } finally {
      setAnalyzeBusy(false);
    }
  };

  const handleRunAnalyze = async () => {
    if (!selectedUploadId) return;

    const rowIndices = parsedTestRowIndices;
    const isWholeUpload = activeAnalyzeTest.wholeUpload === true;

    if (!isWholeUpload) {
      if (rowIndices.length === 0) {
        setMessage('Enter at least one valid row index (0-based).');
        return;
      }

      if (!activeAnalyzeTest.multiRow && !rowIndices.includes(activeRowIndex)) {
        setMessage('Pick an active row from your test subset.');
        return;
      }
    }

    setAnalyzeBusy(true);
    setMessage(null);
    setAnalyzeNotice(null);
    setAnalyzeOutputJson(null);
    setAnalyzeUrls([]);
    setAnalyzeCost(null);
    setAnalyzeScorecard(null);
    setAnalyzeStreetViewPreview(null);

    try {
      if (analyzeTest === 'fec-sweep') {
        const res = await fetch(`/api/uploads/${selectedUploadId}/fec-sweep`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        });
        const data = await res.json();

        if (res.status === 409) {
          if (data.job) {
            setFecSweepJob(data.job);
            setFecSweepHitRate(typeof data.hit_rate_pct === 'number' ? data.hit_rate_pct : null);
          } else {
            await refreshFecSweep(selectedUploadId);
          }
          const notice =
            'FEC sweep is already running for this upload (your second click did not start a duplicate).';
          setAnalyzeNotice({ tone: 'info', text: notice });
          setMessage(notice);
          return;
        }

        if (!res.ok) {
          const err = [data.error, data.hint].filter(Boolean).join(' — ');
          throw new Error(err || 'FEC sweep failed to start');
        }

        const total = data.total_count ?? selectedUpload?.row_count ?? 0;
        const notice =
          data.message ??
          `FEC sweep started for ${total} voters. Progress updates below every few seconds.`;
        setFecSweepJob({
          id: data.jobId,
          status: data.status ?? 'queued',
          processed_count: 0,
          failed_count: 0,
          hits_count: 0,
          total_count: total,
        });
        setFecSweepHitRate(0);
        setFecSweepSampleHits([]);
        setAnalyzeNotice({ tone: 'success', text: notice });
        setMessage(notice);

        const refreshErr = await refreshFecSweep(selectedUploadId);
        if (refreshErr) {
          setAnalyzeNotice({
            tone: 'info',
            text: `${notice} (Status poll: ${refreshErr})`,
          });
        }
        return;
      }

      if (analyzeTest === 'scorecard') {
        const res = await fetch('/api/enrichment/scorecard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadId: selectedUploadId,
            mode: analyzeMode,
            rowIndices,
          }),
        });
        const data = (await res.json()) as EnrichmentScorecard & { error?: string; hint?: string };
        if (!res.ok) throw new Error(data.error ?? data.hint ?? 'Scorecard failed');
        setAnalyzeScorecard(data);
        const m = data.metrics;
        setMessage(
          `Scorecard (${data.mode}): ${data.completed}/${data.row_count} rows · identity probable ${m.identity_probable_pct}% · social ${m.social_found_pct}% · lean labeled ${m.lean_labeled_pct}%${m.total_cost_usd !== null ? ` · $${m.total_cost_usd.toFixed(4)} total` : ''}`,
        );
        return;
      }

      if (analyzeTest === 'street-view') {
        const res = await fetch('/api/enrichment/street-view', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadId: selectedUploadId,
            rowIndex: activeRowIndex,
            mode: 'exploratory',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? data.hint ?? 'Street View test failed');
        setAnalyzeOutputJson(JSON.stringify(data, null, 2));
        const sv = data.street_view_vision as {
          street_view_preview?: string;
          lean_street_view?: string;
          lean_street_view_confidence?: number;
          status?: string;
          visible_cues?: string[];
        };
        if (typeof sv?.street_view_preview === 'string') {
          setAnalyzeStreetViewPreview(sv.street_view_preview);
        }
        const costUsd = data.street_view_vision?.usage?.cost_usd;
        setAnalyzeCost(
          typeof costUsd === 'number'
            ? `$${costUsd.toFixed(4)} · street-view · row ${activeRowIndex}`
            : `street-view · row ${activeRowIndex}`,
        );
        setMessage(
          `Street View (row ${activeRowIndex}): ${sv?.status ?? '?'} · lean_street_view ${sv?.lean_street_view ?? 'Undetermined'} (${sv?.lean_street_view_confidence ?? 0}%)${typeof costUsd === 'number' ? ` · $${costUsd.toFixed(4)}` : ''}`,
        );
        return;
      }

      if (analyzeTest === 'fec') {
        const res = await fetch('/api/enrichment/fec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId: selectedUploadId, rowIndices }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? data.hint ?? 'FEC lookup failed');
        setAnalyzeOutputJson(JSON.stringify(data, null, 2));
        setMessage(
          `FEC lookup: ${data.rows_with_hits}/${data.row_count} rows with Schedule A hits`,
        );
        return;
      }

      const res = await fetch('/api/enrichment/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: selectedUploadId,
          rowIndex: activeRowIndex,
          mode: analyzeMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.hint ?? 'Enrichment test failed');
      setAnalyzeOutputJson(JSON.stringify(data, null, 2));
      setAnalyzeUrls(
        Array.isArray(data.urls_searched)
          ? data.urls_searched
          : (data.result?.enrichment?.citations ?? []),
      );
      const costUsd = data.usage?.cost_usd;
      setAnalyzeCost(
        typeof costUsd === 'number'
          ? `$${costUsd.toFixed(4)} · web ${data.usage?.web_search_calls ?? 0} · x ${data.usage?.x_search_calls ?? 0} · row ${activeRowIndex} · ${data.mode}`
          : null,
      );
      const r = data.result;
      const apifySummary =
        data.mode === 'apify-modular' && Array.isArray(data.apify_runs)
          ? ` · apify ${data.apify_runs.map((run: { status: string; actor_key: string }) => `${run.actor_key}:${run.status}`).join(', ')}`
          : '';
      setMessage(
        `${data.mode} (row ${activeRowIndex}): identity ${r?.identity_resolution_status} (${Math.round((r?.identity_best_match_score ?? 0) * 100)}%) · lean ${r?.lean} (${r?.confidence}%) · signals ${r?.lean_signals_found ? 'yes' : 'no'}${apifySummary}${typeof costUsd === 'number' ? ` · $${costUsd.toFixed(4)}` : ''}`,
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Analysis failed';
      setAnalyzeNotice({ tone: 'error', text });
      setMessage(text);
    } finally {
      setAnalyzeBusy(false);
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
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              <span className="font-medium">Batch inference is off.</span> Upload + parse only —
              use the test subset below for per-voter Grok, Apify, Street View, or FEC runs.
              Full-file jobs are blocked until we validate cost and quality.
            </div>
            <div className="flex flex-wrap items-center gap-3">
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

            <div className="rounded-xl border border-white/15 bg-black/10 p-4 space-y-4">
              <div>
                <h3 className="font-medium">POC test subset</h3>
                <p className="mt-1 text-xs opacity-70">
                  0-based row indices from this upload. Identity and lean are separate — rural NPAs
                  may resolve in directories but stay lean-Undetermined.
                </p>
              </div>

              {analyzeTest !== 'fec-sweep' && (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-medium opacity-80" htmlFor="test-row-indices">
                    Row indices
                  </label>
                  <button
                    type="button"
                    onClick={loadSuggestedTestRows}
                    className="text-xs underline opacity-70 hover:opacity-100"
                  >
                    Load suggested ({suggestedTestRows.length})
                  </button>
                </div>
                <input
                  id="test-row-indices"
                  type="text"
                  value={testRowIndicesInput}
                  onChange={(e) => setTestRowIndicesInput(e.target.value)}
                  placeholder="0, 13, 7, 371, 19, 208, 32"
                  className="w-full rounded-lg border bg-black/20 px-3 py-2 font-mono text-sm"
                />
                <p className="mt-1 text-xs opacity-60">
                  {parsedTestRowIndices.length > 0
                    ? `${parsedTestRowIndices.length} row${parsedTestRowIndices.length === 1 ? '' : 's'} parsed`
                    : 'No valid indices — use comma or space separated numbers'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {suggestedTestRows.map((row) => (
                    <button
                      key={row.rowIndex}
                      type="button"
                      title={row.note}
                      onClick={() => {
                        setActiveRowIndex(row.rowIndex);
                        if (!parsedTestRowIndices.includes(row.rowIndex)) {
                          setTestRowIndicesInput(
                            formatRowIndices([...parsedTestRowIndices, row.rowIndex]),
                          );
                        }
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-xs hover:opacity-90 ${
                        activeRowIndex === row.rowIndex
                          ? 'border-emerald-400/70 bg-emerald-500/15'
                          : 'border-white/20 bg-black/10'
                      }`}
                    >
                      {row.rowIndex}: {row.scenario}
                    </button>
                  ))}
                </div>
              </div>
              )}

              {analyzeTest === 'fec-sweep' && selectedUpload && (
                <p className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs">
                  Runs FEC Schedule A lookup on all <strong>{selectedUpload.row_count}</strong>{' '}
                  voters in this upload. Free API (your <code>FEC_API_KEY</code>), throttled ~900/hr.
                  Calhoun (~736) ≈ 50 min; Alachua (~40k) ≈ 45 hrs — runs in background with auto-resume.
                </p>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium opacity-80" htmlFor="analyze-test">
                    Test to run
                  </label>
                  <select
                    id="analyze-test"
                    value={analyzeTest}
                    onChange={(e) => setAnalyzeTest(e.target.value as AnalyzeTest)}
                    className="mt-1 block w-full rounded-lg border bg-black/20 px-2 py-2 text-sm"
                  >
                    {ANALYZE_TEST_OPTIONS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs opacity-60">{activeAnalyzeTest.description}</p>
                </div>

                {activeAnalyzeTest.needsMode ? (
                  <div>
                    <label className="text-xs font-medium opacity-80" htmlFor="analyze-mode">
                      Pipeline mode
                    </label>
                    <select
                      id="analyze-mode"
                      value={analyzeMode}
                      onChange={(e) => setAnalyzeMode(e.target.value as EnrichmentMode)}
                      className="mt-1 block w-full rounded-lg border bg-black/20 px-2 py-2 text-sm"
                    >
                      {ENRICHMENT_MODES.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs opacity-60">
                      {ENRICHMENT_MODES.find((m) => m.id === analyzeMode)?.description}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-end">
                    <p className="text-xs opacity-60">
                      {activeAnalyzeTest.wholeUpload
                        ? `Runs on all ${selectedUpload?.row_count ?? '…'} voters in upload.`
                        : activeAnalyzeTest.multiRow
                          ? `Runs on all ${parsedTestRowIndices.length || '…'} rows in subset.`
                          : 'Runs on the active row below.'}
                    </p>
                  </div>
                )}
              </div>

              {!activeAnalyzeTest.multiRow && analyzeTest !== 'fec-sweep' && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-sm opacity-80" htmlFor="active-row-index">
                    Active row
                  </label>
                  <select
                    id="active-row-index"
                    value={activeRowIndex}
                    onChange={(e) => setActiveRowIndex(Number(e.target.value))}
                    disabled={parsedTestRowIndices.length === 0}
                    className="rounded-lg border bg-black/20 px-2 py-1.5 text-sm"
                  >
                    {parsedTestRowIndices.map((idx) => {
                      const meta = suggestedTestRows.find((r) => r.rowIndex === idx);
                      return (
                        <option key={idx} value={idx}>
                          {idx}
                          {meta ? ` — ${meta.scenario}` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {analyzeNotice && (
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    analyzeNotice.tone === 'error'
                      ? 'border-red-400/50 bg-red-500/15 text-red-100'
                      : analyzeNotice.tone === 'success'
                        ? 'border-emerald-400/50 bg-emerald-500/15'
                        : 'border-sky-400/40 bg-sky-500/10'
                  }`}
                  role="status"
                >
                  {analyzeNotice.text}
                </div>
              )}

              {(analyzeTest === 'fec-sweep' || fecSweepJob) && (
                <div className="rounded-lg border border-sky-400/40 bg-sky-950/30 p-3">
                  <h4 className="text-sm font-semibold">FEC whole-file sweep</h4>
                  {!fecSweepJob ? (
                    <p className="mt-1 text-xs opacity-75">
                      No sweep on this upload yet. Click <strong>Run fec sweep (whole file)</strong>{' '}
                      — progress appears here (not at the bottom of the page).
                    </p>
                  ) : (
                    <>
                      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm">
                          Status: <span className="font-medium uppercase">{fecSweepJob.status}</span>
                          {' · '}
                          {fecSweepJob.processed_count}/{fecSweepJob.total_count} checked
                          {fecSweepJob.hits_count > 0 ? ` · ${fecSweepJob.hits_count} hits` : ''}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs opacity-70">
                          {fecSweepHitRate !== null && fecSweepJob.processed_count > 0 && (
                            <span>Hit rate {fecSweepHitRate}% · $0 API cost</span>
                          )}
                          {fecSweepLastUpdated && (
                            <span>
                              Updated {fecSweepLastUpdated.toLocaleTimeString()}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => selectedUploadId && refreshFecSweep(selectedUploadId)}
                            className="underline hover:opacity-100"
                          >
                            Refresh now
                          </button>
                        </div>
                      </div>
                      {(fecSweepJob.status === 'running' || fecSweepJob.status === 'queued') && (
                        <div className="mt-2">
                          <div className="mb-1 flex justify-between text-xs opacity-80">
                            <span>
                              {fecSweepJob.status === 'queued' && fecSweepJob.processed_count === 0
                                ? 'Starting worker…'
                                : 'Progress'}
                            </span>
                            <span>{fecSweepProgressPct}%</span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/30">
                            <div
                              className="h-full bg-sky-400 transition-all duration-500"
                              style={{ width: `${Math.max(fecSweepProgressPct, fecSweepJob.status === 'queued' ? 2 : 0)}%` }}
                            />
                          </div>
                          <p className="mt-2 text-xs opacity-60">
                            Runs in the background (~4s per voter). Auto-refreshes every 5s while this
                            tab is visible; switching away pauses updates until you return.
                            {fecSweepJob.status === 'queued' && fecSweepJob.processed_count === 0
                              ? ' If stuck at 0% for several minutes, check Vercel logs.'
                              : ''}
                          </p>
                        </div>
                      )}
                      {fecSweepJob.status === 'completed' && (
                        <p className="mt-2 text-xs opacity-80">
                          Complete — {fecSweepJob.hits_count} of {fecSweepJob.processed_count}{' '}
                          voters had Schedule A hits
                          {fecSweepJob.failed_count > 0
                            ? ` · ${fecSweepJob.failed_count} API errors`
                            : ''}
                          .
                        </p>
                      )}
                      {fecSweepJob.status === 'failed' && fecSweepJob.error_message && (
                        <p className="mt-2 text-xs text-red-200">{fecSweepJob.error_message}</p>
                      )}
                      {fecSweepSampleHits.length > 0 && (
                        <ul className="mt-2 max-h-32 space-y-1 overflow-auto text-xs opacity-90">
                          {fecSweepSampleHits.map((hit) => (
                            <li key={hit.row_index}>
                              Row {hit.row_index}: {hit.contributor_name} · {hit.match_level} ·{' '}
                              {hit.result_count} match(es)
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRunAnalyze}
                  disabled={
                    analyzeBusy ||
                    busy ||
                    (!activeAnalyzeTest.wholeUpload && parsedTestRowIndices.length === 0) ||
                    (analyzeTest === 'fec-sweep' &&
                      (fecSweepJob?.status === 'running' || fecSweepJob?.status === 'queued'))
                  }
                  className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {analyzeBusy && analyzeTest === 'fec-sweep'
                    ? 'Starting FEC sweep…'
                    : analyzeBusy
                      ? 'Running…'
                      : `Run ${activeAnalyzeTest.label.toLowerCase()}`}
                </button>
                {fecSweepJob &&
                  (fecSweepJob.status === 'running' || fecSweepJob.status === 'queued') && (
                    <button
                      type="button"
                      onClick={handleCancelFecSweep}
                      disabled={analyzeBusy || busy}
                      className="rounded-lg border border-amber-400/60 px-4 py-2.5 text-sm hover:opacity-80 disabled:opacity-50"
                    >
                      Cancel FEC sweep
                    </button>
                  )}
              </div>

              {analyzeScorecard && (
                <div className="mt-4 rounded-lg border border-white/15 bg-black/20 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="text-sm font-medium">
                      POC scorecard · {analyzeScorecard.mode} · {analyzeScorecard.completed}/
                      {analyzeScorecard.row_count} completed
                      {analyzeScorecard.failed > 0
                        ? ` · ${analyzeScorecard.failed} failed`
                        : ''}
                    </h4>
                    {analyzeScorecard.metrics.total_cost_usd !== null && (
                      <span className="text-xs opacity-70">
                        Total ${analyzeScorecard.metrics.total_cost_usd.toFixed(4)}
                        {analyzeScorecard.metrics.extrapolated_cost_per_10k !== null &&
                          ` · ~$${analyzeScorecard.metrics.extrapolated_cost_per_10k.toLocaleString()}/10k`}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {(
                      [
                        ['Identity probable', analyzeScorecard.metrics.identity_probable_pct],
                        ['Social found', analyzeScorecard.metrics.social_found_pct],
                        ['Lean labeled', analyzeScorecard.metrics.lean_labeled_pct],
                        ['Lean signals', analyzeScorecard.metrics.lean_signals_pct],
                        [
                          'Median cost',
                          analyzeScorecard.metrics.median_cost_usd !== null
                            ? `$${analyzeScorecard.metrics.median_cost_usd.toFixed(4)}`
                            : '—',
                        ],
                        [
                          'Mean cost',
                          analyzeScorecard.metrics.mean_cost_usd !== null
                            ? `$${analyzeScorecard.metrics.mean_cost_usd.toFixed(4)}`
                            : '—',
                        ],
                      ] as const
                    ).map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-center"
                      >
                        <div className="text-lg font-semibold tabular-nums">
                          {typeof value === 'number' ? `${value}%` : value}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide opacity-60">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-white/10 opacity-70">
                          <th className="py-1.5 pr-2">Row</th>
                          <th className="py-1.5 pr-2">Scenario</th>
                          <th className="py-1.5 pr-2">Identity</th>
                          <th className="py-1.5 pr-2">Social</th>
                          <th className="py-1.5 pr-2">Lean</th>
                          <th className="py-1.5 pr-2">Signals</th>
                          <th className="py-1.5 pr-2 text-right">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analyzeScorecard.rows.map((row) => (
                          <tr
                            key={row.rowIndex}
                            className="border-b border-white/5 hover:bg-white/5"
                            title={row.note}
                          >
                            <td className="py-1.5 pr-2 tabular-nums">{row.rowIndex}</td>
                            <td className="py-1.5 pr-2">{row.scenario}</td>
                            <td className="py-1.5 pr-2">
                              {row.error ? (
                                <span className="text-red-300">{row.error}</span>
                              ) : (
                                <>
                                  {row.identity_resolution_status}{' '}
                                  {row.identity_best_match_score !== null &&
                                    `(${Math.round(row.identity_best_match_score * 100)}%)`}
                                </>
                              )}
                            </td>
                            <td className="py-1.5 pr-2">{row.social_found ? 'yes' : 'no'}</td>
                            <td className="py-1.5 pr-2">{row.lean ?? '—'}</td>
                            <td className="py-1.5 pr-2">
                              {row.lean_signals_found ? 'yes' : 'no'}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">
                              {row.cost_usd !== null ? `$${row.cost_usd.toFixed(4)}` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {analyzeStreetViewPreview && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium opacity-80">Street View preview (sent to Grok)</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={analyzeStreetViewPreview}
                    alt="Google Street View at voter residence"
                    className="max-h-64 rounded-lg border border-white/20"
                  />
                </div>
              )}
              {analyzeCost && (
                <p className="mt-3 text-xs opacity-80">
                  <span className="font-medium">This request:</span> {analyzeCost}
                  {analyzeTest === 'enrichment' && (
                    <>
                      {' · '}
                      <span className="opacity-70">
                        ~$330/order-of-magnitude per 10k at this rate (see docs/COST-ESTIMATES.md)
                      </span>
                    </>
                  )}
                </p>
              )}
              {analyzeUrls.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium opacity-80">
                    URLs hit ({analyzeUrls.length})
                  </p>
                  <ul className="max-h-40 space-y-1 overflow-auto rounded-lg bg-black/30 p-2 text-xs">
                    {analyzeUrls.map((url) => (
                      <li key={url}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all underline opacity-90 hover:opacity-100"
                        >
                          {url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analyzeOutputJson && (
                <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-black/30 p-3 text-xs">
                  {analyzeOutputJson}
                </pre>
              )}
            </div>
          </section>
        )}

        {jobIsComplete && (
          <section className="panel rounded-2xl p-6 overflow-x-auto">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  Results preview
                  {resultsLoading
                    ? ' (loading…)'
                    : resultsTotal > 0
                      ? ` (${resultsTotal} total)`
                      : ''}
                </h2>
                <p className="mt-1 text-xs opacity-70">
                  {useServerFetch
                    ? selectedUploadRowCount > 1000
                      ? `This upload has ${selectedUploadRowCount} rows — sort and filter re-fetch from the database.`
                      : 'Filters re-fetch from the database so you search all rows, not just what is loaded.'
                    : `All ${resultsTotal} rows are in your browser — click column headers to sort, use filters below. No re-fetch needed.`}{' '}
                  Voter column shows a hash; hover for a quick peek or Reveal to pin one name.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                  <option value="all">
                    {useServerFetch ? 'Max (server limit)' : 'All loaded rows'}
                  </option>
                </select>
                {hasActiveFilters(columnFilters) && (
                  <button
                    type="button"
                    onClick={() => setColumnFilters(EMPTY_COLUMN_FILTERS)}
                    className="rounded-lg border px-3 py-1.5 text-sm hover:opacity-80"
                  >
                    Clear filters
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    selectedUploadId &&
                    selectedUpload &&
                    refreshResults(selectedUploadId, selectedUpload.row_count)
                  }
                  className="rounded-lg border px-3 py-1.5 text-sm hover:opacity-80"
                >
                  Re-fetch
                </button>
              </div>
            </div>
            {results.length === 0 && !resultsLoading ? (
              <p className="text-sm opacity-75">
                {hasActiveFilters(columnFilters)
                  ? 'No rows match your filters.'
                  : 'Job finished — loading results. Click Re-fetch or use Export CSV.'}
              </p>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-white/20 text-left">
                    <th className="py-2 pr-4 align-bottom font-semibold">Row</th>
                    {(
                      [
                        ['name', 'Voter'],
                        ['lean', 'Lean'],
                        ['confidence', 'Conf.'],
                        ['turnout', 'Turnout'],
                        ['primary', 'Primary'],
                        ['opposition', 'Opp. score'],
                      ] as const
                    ).map(([col, label]) => (
                      <th key={col} className="py-2 pr-4 align-bottom">
                        <button
                          type="button"
                          onClick={() => handleSortHeader(col)}
                          className="font-semibold hover:opacity-80 text-left"
                        >
                          {label}
                          <span className="opacity-60">{sortIndicator(col)}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-white/10 text-left">
                    <th className="py-2 pr-2" />
                    <th className="py-2 pr-2">
                      <input
                        type="text"
                        placeholder="Name filter…"
                        value={columnFilters.name}
                        onChange={(e) => updateFilter('name', e.target.value)}
                        className="w-full min-w-[7rem] rounded border bg-black/20 px-2 py-1 text-xs"
                      />
                    </th>
                    <th className="py-2 pr-2">
                      <select
                        value={columnFilters.lean}
                        onChange={(e) => updateFilter('lean', e.target.value)}
                        className="w-full rounded border bg-black/20 px-2 py-1 text-xs"
                      >
                        {LEAN_OPTIONS.map((v) => (
                          <option key={v || 'all'} value={v}>
                            {v || 'All'}
                          </option>
                        ))}
                      </select>
                    </th>
                    <th className="py-2 pr-2">
                      <div className="flex gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          placeholder="Min"
                          value={columnFilters.confidenceMin}
                          onChange={(e) => updateFilter('confidenceMin', e.target.value)}
                          className="w-14 rounded border bg-black/20 px-1 py-1 text-xs"
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          placeholder="Max"
                          value={columnFilters.confidenceMax}
                          onChange={(e) => updateFilter('confidenceMax', e.target.value)}
                          className="w-14 rounded border bg-black/20 px-1 py-1 text-xs"
                        />
                      </div>
                    </th>
                    <th className="py-2 pr-2">
                      <select
                        value={columnFilters.turnout}
                        onChange={(e) => updateFilter('turnout', e.target.value)}
                        className="w-full rounded border bg-black/20 px-2 py-1 text-xs"
                      >
                        {TURNOUT_OPTIONS.map((v) => (
                          <option key={v || 'all'} value={v}>
                            {v || 'All'}
                          </option>
                        ))}
                      </select>
                    </th>
                    <th className="py-2 pr-2">
                      <input
                        type="text"
                        placeholder="Filter…"
                        value={columnFilters.primary}
                        onChange={(e) => updateFilter('primary', e.target.value)}
                        className="w-full min-w-[5rem] rounded border bg-black/20 px-2 py-1 text-xs"
                      />
                    </th>
                    <th className="py-2 pr-2">
                      <div className="flex gap-1">
                        <input
                          type="number"
                          placeholder="Min"
                          value={columnFilters.oppositionMin}
                          onChange={(e) => updateFilter('oppositionMin', e.target.value)}
                          className="w-14 rounded border bg-black/20 px-1 py-1 text-xs"
                        />
                        <input
                          type="number"
                          placeholder="Max"
                          value={columnFilters.oppositionMax}
                          onChange={(e) => updateFilter('oppositionMax', e.target.value)}
                          className="w-14 rounded border bg-black/20 px-1 py-1 text-xs"
                        />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePreviewRows.map((row) => (
                    <tr key={row.voter_hash} className="border-b border-white/10">
                      <td className="py-2 pr-4 font-mono text-xs tabular-nums opacity-80">
                        {row.row_index ?? '—'}
                      </td>
                      <td className="py-2 pr-4">
                        {revealedVoterHash === row.voter_hash ? (
                          <div className="flex items-center gap-2">
                            <span>{row.raw_data?.name?.full ?? '—'}</span>
                            <button
                              type="button"
                              onClick={() => setRevealedVoterHash(null)}
                              className="rounded border border-white/20 px-1.5 py-0.5 text-xs opacity-70 hover:opacity-100"
                              title="Hide name"
                            >
                              Hide
                            </button>
                          </div>
                        ) : (
                          <div className="group/hash relative flex items-center gap-2">
                            <span className="font-mono text-xs opacity-80">
                              {shortHash(row.voter_hash)}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleRevealName(row.voter_hash)}
                              className="rounded border border-white/20 px-1.5 py-0.5 text-xs opacity-70 hover:opacity-100"
                            >
                              Reveal
                            </button>
                            <span
                              role="tooltip"
                              className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden whitespace-nowrap rounded border border-white/20 bg-black/90 px-2 py-1 text-xs font-sans shadow-lg group-hover/hash:block"
                            >
                              {row.raw_data?.name?.full ?? '—'}
                            </span>
                          </div>
                        )}
                      </td>
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
            {(results.length > 0 || hasActiveFilters(columnFilters)) && (
              <p className="mt-3 text-xs opacity-70">
                Showing {visiblePreviewRows.length}
                {hasActiveFilters(columnFilters)
                  ? ` of ${resultsFiltered} matching`
                  : useServerFetch
                    ? ''
                    : ` of ${displayResults.length}`}{' '}
                · {resultsTotal} total in upload · sorted by {SORT_COLUMN_LABELS[sortColumn]}{' '}
                {sortDirection === 'asc' ? '↑' : '↓'}
                {useServerFetch && hasActiveFilters(columnFilters)
                  ? ' · filters applied server-side'
                  : !useServerFetch
                    ? ' · sort/filter in browser'
                    : ''}
                {resultsLoading ? ' · updating…' : ''}
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