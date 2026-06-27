import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';

export async function GET(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { uploadId } = await context.params;
    const { searchParams } = new URL(request.url);
    const lean = searchParams.get('lean');

    const { rows } = await withUserDb(userEmail, (client) => {
      const params: unknown[] = [uploadId, userEmail];
      let filter = '';
      if (lean) {
        params.push(lean);
        filter = ` AND r.lean = $3`;
      }

      return client.query(
        `SELECT r.*, vr.raw_data
         FROM lean_results r
         JOIN voter_records vr ON vr.id = r.voter_record_id
         WHERE r.upload_id = $1 AND r.user_id = $2${filter}
         ORDER BY r.created_at DESC
         LIMIT 1000`,
        params,
      );
    });

    return NextResponse.json({ results: rows });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 });
  }
}