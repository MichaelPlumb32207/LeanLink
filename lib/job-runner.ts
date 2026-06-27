import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export const WORKER_MAX_DURATION_SEC = 800;
export const WORKER_TIME_BUDGET_RATIO = 0.8;
export const WORKER_CONCURRENCY = 3;
export const WORKER_BATCH_CLAIM_SIZE = 10;
export const ROW_TIMEOUT_MS = 60_000;

export type LeanLabel = 'Left' | 'Right' | 'Independent' | 'Undetermined';

export interface MockLeanResult {
  lean: LeanLabel;
  confidence: number;
  confidence_band: string;
  evidence: string[];
  matched_social: string[];
  audit: {
    timestamp: string;
    sources: string[];
    model_version: string;
  };
}

function confidenceBand(confidence: number): string {
  if (confidence >= 70) return 'High';
  if (confidence >= 45) return 'Medium';
  return 'Low';
}

export function mockInferLean(record: ParsedFlVoterRecord): MockLeanResult {
  const seed = record.voterId.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const leanOptions: LeanLabel[] = ['Left', 'Right', 'Independent', 'Undetermined'];
  const lean = leanOptions[seed % leanOptions.length];
  const confidence = 35 + (seed % 56);

  return {
    lean,
    confidence,
    confidence_band: confidenceBand(confidence),
    evidence: [
      `Residence in ${record.residence.city || 'Calhoun County'} (precinct ${record.precinct})`,
      record.email ? 'Email present on voter file' : 'No email on voter file — enrichment would run',
      record.phone ? 'Phone present on voter file' : 'No phone on voter file',
    ],
    matched_social: record.email ? [`possible-match-${record.voterId}@social.stub`] : [],
    audit: {
      timestamp: new Date().toISOString(),
      sources: ['MockEnrichment', 'MockGrok'],
      model_version: 'mock-v1',
    },
  };
}

export function getWorkerDeadlineMs(): number {
  return Date.now() + WORKER_MAX_DURATION_SEC * 1000 * WORKER_TIME_BUDGET_RATIO;
}

export async function triggerWorker(jobId: string): Promise<void> {
  const baseUrl =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const url = `${baseUrl.replace(/\/$/, '')}/api/jobs/${jobId}/worker`;

  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.INTERNAL_JOB_SECRET}`,
      'Content-Type': 'application/json',
    },
  }).catch((error) => {
    console.error('Worker chain trigger failed', jobId, error);
  });
}