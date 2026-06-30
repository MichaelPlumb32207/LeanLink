'use client';

import { useState } from 'react';
import type { LeanLabel } from '@/lib/enrichment/types';

export function CommitteeQuickLabel({
  uploadId,
  committeeName,
  onSaved,
}: {
  uploadId: string;
  committeeName: string;
  onSaved: () => void;
}) {
  const [lean, setLean] = useState<LeanLabel>('Left');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/committee-lean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          committee_name: committeeName,
          lean,
          upload_id: uploadId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, data.hint].filter(Boolean).join(' — '));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs">
      <select
        value={lean}
        onChange={(e) => setLean(e.target.value as LeanLabel)}
        className="rounded border bg-black/25 px-1 py-0.5"
      >
        <option value="Left">Left</option>
        <option value="Right">Right</option>
        <option value="Independent">Independent</option>
      </select>
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded border border-violet-300/40 px-1.5 py-0.5 text-violet-200 hover:bg-violet-500/10 disabled:opacity-50"
      >
        {saving ? '…' : 'Label'}
      </button>
      {error && <span className="text-red-300">{error}</span>}
    </span>
  );
}