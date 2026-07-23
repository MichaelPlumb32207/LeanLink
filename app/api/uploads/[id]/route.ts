import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import {
  LEAN_PRECEDENCE_OPTIONS,
  parseLeanPrecedence,
  type LeanPrecedenceMode,
} from '@/lib/lean-precedence';

const PREC_IDS = new Set(LEAN_PRECEDENCE_OPTIONS.map((o) => o.id));

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: uploadId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      lean_precedence?: string;
    };

    if (body.lean_precedence === undefined) {
      return NextResponse.json(
        { error: 'Nothing to update (expected lean_precedence)' },
        { status: 400 },
      );
    }

    const mode = parseLeanPrecedence(body.lean_precedence);
    // Reject free-form garbage that parse would silently default to wallet.
    const raw = String(body.lean_precedence ?? '')
      .trim()
      .toLowerCase();
    const aliases = new Set([
      'wallet',
      'registration',
      'reg',
      'party',
      'conflict_undetermined',
      'conflict',
      'undetermined',
    ]);
    if (raw && !aliases.has(raw) && !PREC_IDS.has(raw as LeanPrecedenceMode)) {
      return NextResponse.json(
        {
          error: `Invalid lean_precedence (want: ${[...PREC_IDS].join(' | ')})`,
        },
        { status: 400 },
      );
    }

    const result = await withUserDb(userEmail, (client) =>
      client.query<{ id: string; lean_precedence: string }>(
        `UPDATE voter_uploads
         SET lean_precedence = $3
         WHERE id = $1 AND user_id = $2
         RETURNING id, lean_precedence`,
        [uploadId, userEmail, mode],
      ),
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    return NextResponse.json({
      uploadId,
      lean_precedence: result.rows[0].lean_precedence,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Patch upload failed', error);
    return NextResponse.json({ error: 'Failed to update upload' }, { status: 500 });
  }
}

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
