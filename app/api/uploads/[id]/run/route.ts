import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  BATCH_INFERENCE_DISABLED_MESSAGE,
  isBatchInferenceEnabled,
} from '@/lib/batch-inference';
import { withUserDb } from '@/lib/db';
import { triggerWorker } from '@/lib/job-runner';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!isBatchInferenceEnabled()) {
      return NextResponse.json(
        { error: BATCH_INFERENCE_DISABLED_MESSAGE },
        { status: 403 },
      );
    }

    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: uploadId } = await context.params;

    const job = await withUserDb(userEmail, async (client) => {
      const upload = await client.query(
        `SELECT id, row_count FROM voter_uploads WHERE id = $1 AND user_id = $2`,
        [uploadId, userEmail],
      );
      if (upload.rows.length === 0) {
        return null;
      }

      const running = await client.query(
        `SELECT id FROM processing_jobs
         WHERE upload_id = $1 AND user_id = $2 AND status IN ('queued', 'running')
         LIMIT 1`,
        [uploadId, userEmail],
      );
      if (running.rows.length > 0) {
        return { existingJobId: running.rows[0].id as string };
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO processing_jobs (upload_id, user_id, status, total_count, last_heartbeat_at)
         VALUES ($1, $2, 'queued', $3, NOW())
         RETURNING id`,
        [uploadId, userEmail, upload.rows[0].row_count],
      );

      await client.query(`UPDATE voter_uploads SET status = 'processing' WHERE id = $1`, [uploadId]);

      return { jobId: inserted.rows[0].id };
    });

    if (!job) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    const jobId = ('jobId' in job ? job.jobId : job.existingJobId) as string;
    await triggerWorker(jobId);

    return NextResponse.json({ jobId, started: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Run job failed', error);
    return NextResponse.json({ error: 'Failed to start job' }, { status: 500 });
  }
}