import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { appendEvidenceEvent, fuseAndPersistVoter } from '@/lib/evidence/ledger';
import { buildLeanReviewEvent } from '@/lib/evidence/human-judgment';
import type { LeanLabel } from '@/lib/enrichment/types';

/**
 * Researcher review actions on one voter's fused lean.
 *
 * - accept    — affirm the current fused lean as final: freezes the deliverable
 *               values (fusion stops rewriting them) and excludes the voter from
 *               all further arms. Recorded as a human_judgment evidence event.
 * - reopen    — clear an acceptance; fusion resumes (and catches up on any
 *               evidence that arrived while frozen).
 * - re_enroll — push an already-settled voter back into later arms (billing is
 *               unaffected: the settlement fee was charged once, ever).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: voterRecordId } = await context.params;
    const body = await request.json();
    const action = String(body.action ?? '');
    const note = typeof body.note === 'string' ? body.note.slice(0, 500) : undefined;

    if (!['accept', 'reopen', 're_enroll'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be accept, reopen, or re_enroll' },
        { status: 400 },
      );
    }

    const result = await withUserDb(userEmail, async (client) => {
      const { rows } = await client.query<{
        upload_id: string;
        lean: string | null;
        confidence: number | null;
        fusion_status: string | null;
        review_status: string | null;
        contributing_arms: unknown;
      }>(
        `SELECT upload_id, lean, confidence, fusion_status, review_status, contributing_arms
         FROM voter_lean_fusion WHERE voter_record_id = $1`,
        [voterRecordId],
      );
      const fusion = rows[0];
      if (!fusion) return { status: 404 as const, error: 'No fusion result for this voter' };

      const arms = Array.isArray(fusion.contributing_arms)
        ? (fusion.contributing_arms as string[])
        : [];

      if (action === 'accept') {
        if (!fusion.lean || fusion.lean === 'Undetermined') {
          return { status: 400 as const, error: 'No fused lean to accept for this voter' };
        }
        await client.query(
          `UPDATE voter_lean_fusion
           SET review_status = 'accepted', reviewed_at = NOW()
           WHERE voter_record_id = $1`,
          [voterRecordId],
        );
        await appendEvidenceEvent(
          client,
          buildLeanReviewEvent({
            upload_id: fusion.upload_id,
            voter_record_id: voterRecordId,
            user_id: userEmail,
            action: 'accept',
            lean: fusion.lean as LeanLabel,
            confidence: fusion.confidence,
            contributing_arms: arms,
            note,
          }),
        );
      } else if (action === 'reopen') {
        await client.query(
          `UPDATE voter_lean_fusion
           SET review_status = NULL, reviewed_at = NULL
           WHERE voter_record_id = $1`,
          [voterRecordId],
        );
        await appendEvidenceEvent(
          client,
          buildLeanReviewEvent({
            upload_id: fusion.upload_id,
            voter_record_id: voterRecordId,
            user_id: userEmail,
            action: 'reopen',
            lean: 'Undetermined',
            confidence: null,
            contributing_arms: arms,
            note,
          }),
        );
        // Catch fusion up on anything that arrived while the voter was frozen.
        await fuseAndPersistVoter(client, voterRecordId, fusion.upload_id, userEmail);
      } else {
        if (fusion.review_status === 'accepted') {
          return { status: 400 as const, error: 'Voter is accepted — reopen before re-enrolling' };
        }
        await client.query(
          `UPDATE voter_lean_fusion
           SET research_status = 're_enrolled', re_enrolled_at = NOW()
           WHERE voter_record_id = $1`,
          [voterRecordId],
        );
      }

      const after = await client.query(
        `SELECT lean, confidence, fusion_status, review_status, research_status,
                settled_arm, settled_tier
         FROM voter_lean_fusion WHERE voter_record_id = $1`,
        [voterRecordId],
      );
      return { status: 200 as const, fusion: after.rows[0] };
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ fusion: result.fusion });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const detail = error instanceof Error ? error.message : 'Review action failed';
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
