import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { listUncertainCommittees } from '@/lib/committee-lean/queue';
import { refusionFlContribForCommittee } from '@/lib/committee-lean/refusion';
import { upsertCommitteeLeanLabel } from '@/lib/committee-lean/store';
import { withUserDb } from '@/lib/db';
import type { LeanLabel } from '@/lib/enrichment/types';

const LEAN_OPTIONS: LeanLabel[] = ['Left', 'Right', 'Independent', 'Undetermined'];

export async function GET(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { searchParams } = new URL(request.url);
    const uploadId = searchParams.get('uploadId');

    const data = await withUserDb(userEmail, async (client) => {
      return listUncertainCommittees(client, userEmail, uploadId);
    });

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Failed to load committee lean queue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const body = (await request.json()) as {
      committee_name?: string;
      lean?: string;
      confidence?: number;
      notes?: string;
      upload_id?: string;
    };

    if (!body.committee_name?.trim()) {
      return NextResponse.json({ error: 'committee_name is required' }, { status: 400 });
    }
    const lean = body.lean as LeanLabel;
    if (!LEAN_OPTIONS.includes(lean)) {
      return NextResponse.json(
        { error: 'lean must be Left, Right, Independent, or Undetermined' },
        { status: 400 },
      );
    }

    const result = await withUserDb(userEmail, async (client) => {
      const label = await upsertCommitteeLeanLabel(client, {
        user_id: userEmail,
        committee_name: body.committee_name!,
        lean,
        confidence: body.confidence,
        notes: body.notes,
      });

      const refusion =
        lean !== 'Undetermined'
          ? await refusionFlContribForCommittee(client, {
              user_id: userEmail,
              committee_name: body.committee_name!,
            })
          : { voters_refused: 0 };

      const queue = await listUncertainCommittees(client, userEmail, body.upload_id ?? null);
      return { label, refusion, queue };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Failed to save committee label';
    return NextResponse.json(
      {
        error: message,
        hint:
          message.includes('committee_lean_labels') || message.includes('does not exist')
            ? 'Apply migrations/007_committee_lean.sql on Neon.'
            : undefined,
      },
      { status: 500 },
    );
  }
}