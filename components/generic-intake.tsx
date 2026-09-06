'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface AccountOption {
  account_id: string;
  display_name: string;
  prepaid_balance_usd: string;
}

interface IntakeResult {
  uploadId: string;
  rowCount: number;
  rejected: number;
  baselineCharged: number;
  baselineCostUsd: number;
  bandCounts: Record<string, number>;
}

const SAMPLE = `name,county,address,city,zip,dob,email,employer
"Smith, Jane Q",Alachua,123 Main St,Gainesville,32601,1980-05-01,jane@example.com,University of Florida
John Rivera,Leon,,Tallahassee,32301,,,`;

/**
 * Flexible client-list intake: paste or drop a CSV/TSV with any of
 * name / county / address / city / state / zip / dob / email / phone /
 * employer / party. Rows are anchor-gated (name + one location field) and, when
 * billed to an account, incur the baseline fee per accepted record.
 */
export function GenericIntake({ onUploaded }: { onUploaded?: (uploadId: string) => void }) {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState('');
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshAccounts = useCallback(async () => {
    const res = await fetch('/api/accounts');
    const data = await res.json();
    if (res.ok) setAccounts(data.accounts ?? []);
  }, []);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  async function onFile(file: File) {
    setFilename(file.name);
    setText(await file.text());
  }

  async function submit() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('sourceType', 'generic');
      if (accountId) form.append('accountId', accountId);
      if (filename) form.append('filename', filename);
      form.append('content', text);

      const res = await fetch('/api/uploads', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        const reasons = Array.isArray(data.sampleReasons) ? ` (${data.sampleReasons.join('; ')})` : '';
        throw new Error(`${data.error ?? 'Upload failed'}${reasons}`);
      }
      setResult(data);
      onUploaded?.(data.uploadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel rounded-2xl p-6">
      <h2 className="mb-1 text-xl font-semibold">List intake</h2>
      <p className="mb-4 text-sm opacity-75">
        Paste or drop a voter list. Required per row: a name plus at least one of county,
        ZIP, or street address. Everything else is optional and sharpens matching.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide opacity-60">
            Account (optional)
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mb-3 block w-full rounded-lg border bg-black/20 px-2 py-2 text-sm"
          >
            <option value="">— No account —</option>
            {accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.display_name} ({a.account_id})
              </option>
            ))}
          </select>
          {accounts.length === 0 && (
            <p className="mb-3 text-xs opacity-60">
              Optional: create an account on /dashboard/accounts to label a batch.
            </p>
          )}

          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border px-4 py-2 text-sm hover:opacity-80"
            >
              Choose CSV
            </button>
            <button
              onClick={() => setText(SAMPLE)}
              className="rounded-lg border px-4 py-2 text-sm hover:opacity-80"
            >
              Fill sample
            </button>
            {filename && <span className="text-xs opacity-70">{filename}</span>}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide opacity-60">
            Paste rows (CSV/TSV with a header line)
          </label>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFilename('');
            }}
            rows={7}
            placeholder="name,county,address,city,zip,dob,email"
            className="w-full rounded-lg border bg-black/20 px-3 py-2 font-mono text-xs"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Processing…' : 'Ingest list'}
        </button>
        {error && <span className="text-sm text-red-300">{error}</span>}
      </div>

      {result && (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm">
          <p className="font-medium">
            Ingested {result.rowCount} record{result.rowCount === 1 ? '' : 's'}
            {result.rejected > 0 ? ` · ${result.rejected} rejected (missing anchor)` : ''}.
          </p>
          <p className="mt-1 opacity-80">
            Completeness:{' '}
            {['rich', 'moderate', 'thin']
              .filter((b) => result.bandCounts[b])
              .map((b) => `${result.bandCounts[b]} ${b}`)
              .join(' · ') || '—'}
          </p>
          {result.baselineCharged > 0 && (
            <p className="mt-1 opacity-80">
              Baseline charged for {result.baselineCharged} records (${result.baselineCostUsd.toFixed(2)}).
            </p>
          )}
        </div>
      )}
    </section>
  );
}
