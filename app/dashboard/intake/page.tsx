'use client';

import Link from 'next/link';
import { useState } from 'react';
import { GenericIntake } from '@/components/generic-intake';

export default function IntakePage() {
  const [lastUploadId, setLastUploadId] = useState<string | null>(null);

  return (
    <main className="theme-matrix min-h-screen p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">List intake</h1>
            <p className="text-sm opacity-70">
              Ingest an arbitrary voter list (no FL voter file required).
            </p>
          </div>
          <Link href="/dashboard" className="rounded-lg border px-4 py-2 text-sm hover:opacity-80">
            ← Dashboard
          </Link>
        </div>

        <GenericIntake onUploaded={setLastUploadId} />

        {lastUploadId && (
          <div className="panel rounded-2xl p-4 text-sm">
            Batch ready. Open the{' '}
            <Link href="/dashboard" className="text-emerald-300 underline">
              dashboard
            </Link>{' '}
            and select the newest upload to run FEC → FL/Sunbiz → OSINT and watch the waterfall
            settle + bill.
          </div>
        )}
      </div>
    </main>
  );
}
