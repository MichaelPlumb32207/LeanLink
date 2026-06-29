import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { getUploadEvidenceSummary } from '@/lib/evidence/ledger';
import { EVIDENCE_ARMS } from '@/lib/evidence/arms';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: uploadId } = await context.params;

    const summary = await withUserDb(userEmail, async (client) => {
      const uploadRes = await client.query(
        `SELECT id FROM voter_uploads WHERE id = $1 AND user_id = $2`,
        [uploadId, userEmail],
      );
      if (uploadRes.rows.length === 0) return null;
      return getUploadEvidenceSummary(client, uploadId, userEmail);
    });

    if (!summary) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    return NextResponse.json({ summary, arm_registry: EVIDENCE_ARMS });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Failed to load evidence summary';
    if (message.includes('evidence_events')) {
      return NextResponse.json(
        {
          error: 'Evidence tables missing',
          hint: 'Apply migrations/005_evidence_ledger.sql',
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}