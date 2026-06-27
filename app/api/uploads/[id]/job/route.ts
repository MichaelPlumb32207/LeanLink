import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: uploadId } = await context.params;

    const { rows } = await withUserDb(userEmail, (client) =>
      client.query(
        `SELECT *
         FROM processing_jobs
         WHERE upload_id = $1 AND user_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [uploadId, userEmail],
      ),
    );

    return NextResponse.json({ job: rows[0] ?? null });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
  }
}