/**
 * Background committee re-fusion — kicks off the "Re-fuse now" bulk action as an
 * arm_run tracked live in the box score, instead of a size-capped inline request
 * (owner ask, D-039). The route creates the run + fires this trigger; the worker
 * route processes pending committees single-pass with heartbeats.
 */
export const REFUSE_ARM = 'committee_refuse';
export const REFUSE_RUNNER = 'committee_refuse_api';

/** ~90% of the worker's 800s budget, leaving room to finish/mark the run. */
const REFUSE_WORKER_MAX_DURATION_SEC = 800;
export function getRefuseDeadlineMs(): number {
  return Date.now() + REFUSE_WORKER_MAX_DURATION_SEC * 1000 * 0.9;
}

/** Fire-and-forget POST to the refuse worker (mirrors lib/job-runner triggerWorker). */
export async function triggerRefuseWorker(runId: string): Promise<void> {
  const baseUrl =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const url = `${baseUrl.replace(/\/$/, '')}/api/committee-lean/refuse-worker/${runId}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.INTERNAL_JOB_SECRET}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      console.error('Refuse worker trigger HTTP error', runId, response.status, await response.text());
    }
  } catch (error) {
    console.error('Refuse worker trigger failed', runId, error);
  }
}
