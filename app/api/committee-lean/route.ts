import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { listUncertainCommittees, countPendingRefusion } from '@/lib/committee-lean/queue';
import { refusionFlContribForCommittee } from '@/lib/committee-lean/refusion';
import {
  REFUSE_ARM,
  REFUSE_RUNNER,
  triggerRefuseWorker,
} from '@/lib/committee-lean/refuse-runner';
import { startArmRun } from '@/lib/evidence/arm-runs';
import { upsertCommitteeLeanLabel, deleteCommitteeLeanLabel } from '@/lib/committee-lean/store';
import { loadLeanPatterns } from '@/lib/lean-patterns/registry';
import { withUserDb } from '@/lib/db';
import type { LeanLabel } from '@/lib/enrichment/types';

const LEAN_OPTIONS: LeanLabel[] = ['Left', 'Right', 'Independent', 'Undetermined'];

// The route just kicks off work; the heavy per-voter re-fusion runs in the
// background worker (refuse-worker route), tracked live in the box score (D-039).
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { searchParams } = new URL(request.url);
    const uploadId = searchParams.get('uploadId');

    const data = await withUserDb(userEmail, async (client) => {
      const queue = await listUncertainCommittees(client, userEmail, uploadId);
      const pending = await countPendingRefusion(client, userEmail, uploadId);
      const { meta } = await loadLeanPatterns(client, userEmail);
      return {
        ...queue,
        pending,
        patterns: { source: meta.source, total: meta.rowCount, invalid: meta.invalidCount },
      };
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
      action?: string;
      committee_name?: string;
      lean?: string;
      confidence?: number;
      notes?: string;
      upload_id?: string;
    };

    // Bulk "Re-fuse now" — book every labeled-but-unfused voter for this upload.
    // Kicks off a background arm_run (no size cap); progress shows in the box
    // score, same as any other arm. The button returns immediately (D-039).
    if (body.action === 'refuse_all') {
      if (!body.upload_id) {
        return NextResponse.json({ error: 'upload_id is required' }, { status: 400 });
      }
      const uploadId = body.upload_id;
      const kickoff = await withUserDb(userEmail, async (client) => {
        const before = await countPendingRefusion(client, userEmail, uploadId);
        if (before.voters_pending === 0) {
          return { started: false as const, alreadyRunning: false, voters_pending: 0 };
        }
        const runId = await startArmRun(client, {
          uploadId,
          userId: userEmail,
          arm: REFUSE_ARM,
          runner: REFUSE_RUNNER,
          totalCount: before.voters_pending,
        });
        return {
          started: runId != null,
          runId,
          alreadyRunning: runId == null, // startArmRun returns null when one is active
          voters_pending: before.voters_pending,
        };
      });
      if (kickoff.started && kickoff.runId) {
        void triggerRefuseWorker(kickoff.runId);
      }
      return NextResponse.json(kickoff);
    }

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
      const pending = await countPendingRefusion(client, userEmail, body.upload_id ?? null);
      return { label, refusion, queue, pending };
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

export async function DELETE(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { searchParams } = new URL(request.url);
    const committee_name = searchParams.get('committee_name');
    const uploadId = searchParams.get('uploadId');
    if (!committee_name?.trim()) {
      return NextResponse.json({ error: 'committee_name is required' }, { status: 400 });
    }

    const result = await withUserDb(userEmail, async (client) => {
      // Delete first, THEN re-fuse — so the re-fuse re-reads labels without this
      // one and reverts the affected voters to pattern-lean / Undetermined.
      const del = await deleteCommitteeLeanLabel(client, {
        user_id: userEmail,
        committee_name,
      });
      const refusion = del.deleted
        ? await refusionFlContribForCommittee(client, { user_id: userEmail, committee_name })
        : { voters_refused: 0 };
      const queue = await listUncertainCommittees(client, userEmail, uploadId);
      const pending = await countPendingRefusion(client, userEmail, uploadId);
      return { deleted: del.deleted, refusion, queue, pending };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Failed to delete committee label';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}