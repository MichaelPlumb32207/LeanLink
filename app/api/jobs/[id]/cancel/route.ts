import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: jobId } = await context.params;

    const result = await withUserDb(userEmail, async (client) => {
      const jobRes = await client.query<{ upload_id: string; status: string }>(
        `SELECT upload_id, status FROM processing_jobs WHERE id = $1 AND user_id = $2`,
        [jobId, userEmail],
      );

      if (jobRes.rows.length === 0) {
        return null;
      }

      const job = jobRes.rows[0];
      if (job.status === 'completed' || job.status === 'cancelled') {
        return { alreadyDone: true as const, status: job.status };
      }

      await client.query(
        `UPDATE processing_jobs
         SET status = 'cancelled',
             completed_at = NOW(),
             last_heartbeat_at = NOW(),
             error_message = 'Cancelled by user'
         WHERE id = $1`,
        [jobId],
      );

      await client.query(
        `UPDATE voter_records
         SET status = 'pending', updated_at = NOW()
         WHERE upload_id = $1 AND user_id = $2 AND status = 'processing'`,
        [job.upload_id, userEmail],
      );

      const uploadRes = await client.query<{ status: string }>(
        `SELECT status FROM voter_uploads WHERE id = $1`,
        [job.upload_id],
      );
      if (uploadRes.rows[0]?.status === 'processing') {
        await client.query(
          `UPDATE voter_uploads SET status = 'ready' WHERE id = $1`,
          [job.upload_id],
        );
      }

      return { cancelled: true as const, uploadId: job.upload_id };
    });

    if (!result) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Cancel job failed', error);
    return NextResponse.json({ error: 'Failed to cancel job' }, { status: 500 });
  }
}