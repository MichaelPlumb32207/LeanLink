import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id } = await context.params;

    const { rows } = await withUserDb(userEmail, (client) =>
      client.query(
        `SELECT j.*, u.filename
         FROM processing_jobs j
         JOIN voter_uploads u ON u.id = j.upload_id
         WHERE j.id = $1 AND j.user_id = $2`,
        [id, userEmail],
      ),
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ job: rows[0] });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
  }
}