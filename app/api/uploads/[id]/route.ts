import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: uploadId } = await context.params;

    const result = await withUserDb(userEmail, (client) =>
      client.query(
        `DELETE FROM voter_uploads
         WHERE id = $1 AND user_id = $2
         RETURNING id, filename`,
        [uploadId, userEmail],
      ),
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    return NextResponse.json({
      deleted: true,
      uploadId,
      filename: result.rows[0].filename,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Delete upload failed', error);
    return NextResponse.json({ error: 'Failed to delete upload' }, { status: 500 });
  }
}