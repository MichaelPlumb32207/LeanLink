// app/dashboard/page.tsx
'use client';

import { useState } from 'react';

export default function Dashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'done'>('idle');
  const [branding, setBranding] = useState<'matrix' | 'red' | 'blue'>('matrix');

  const handleUpload = async () => {
    if (!file) return;
    setStatus('uploading');
    // TODO: Call your API route to start n8n job
    setStatus('processing');
    // Poll or webhook for results
  };

  return (
    <div className={`min-h-screen p-8 ${branding === 'matrix' ? 'matrix' : ''}`}>
      <h1 className="text-4xl font-bold mb-8">LeanLink NPA FL Dashboard</h1>
      
      <div className="flex gap-4 mb-8">
        <button onClick={() => setBranding('matrix')} className="px-4 py-2 bg-green-600 text-white rounded">Matrix Mode</button>
        <button onClick={() => setBranding('red')} className="px-4 py-2 bg-red-600 text-white rounded">Red (Leans Right)</button>
        <button onClick={() => setBranding('blue')} className="px-4 py-2 bg-blue-600 text-white rounded">Blue (Leans Left)</button>
      </div>

      <input type="file" accept=".csv,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <button onClick={handleUpload} disabled={!file || status !== 'idle'} className="ml-4 px-6 py-3 bg-emerald-600 text-white rounded">
        {status === 'idle' ? 'Upload & Analyze' : status}
      </button>

      {/* Results table would go here */}
    </div>
  );
}
