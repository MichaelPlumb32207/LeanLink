import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';

/**
 * Cohort re-enrollment: push settled voters back into later research arms.
 *
 * Settlement normally ends research (the waterfall default). Re-enrolling keeps
 * the NPA in the research process — later arms may still revise lean/confidence
 * — without touching billing (the settlement fee was charged once, ever).
 * Accepted voters are never re-enrolled; reopen them first.
 *
 * Body filters narrow the cohort (both optional, ANDed):
 *   maxConfidence — only voters whose fused confidence is ≤ this
 *   tierLte       — only voters settled at a tier ≤ this (e.g. 1 = FEC-settled)
 * `action: 'withdraw'` clears re-enrollment for the upload instead.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: uploadId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const action = body.action === 'withdraw' ? 'withdraw' : 're_enroll';

    const maxConfidence = Number.isFinite(Number(body.maxConfidence))
      ? Number(body.maxConfidence)
      : null;
    const tierLte = Number.isFinite(Number(body.tierLte)) ? Number(body.tierLte) : null;

    const count = await withUserDb(userEmail, async (client) => {
      if (action === 'withdraw') {
        const res = await client.query(
          `UPDATE voter_lean_fusion
           SET research_status = NULL, re_enrolled_at = NULL
           WHERE upload_id = $1 AND user_id = $2 AND research_status = 're_enrolled'`,
          [uploadId, userEmail],
        );
        return res.rowCount ?? 0;
      }
      const res = await client.query(
        `UPDATE voter_lean_fusion
         SET research_status = 're_enrolled', re_enrolled_at = NOW()
         WHERE upload_id = $1 AND user_id = $2
           AND settled_tier IS NOT NULL
           AND review_status IS DISTINCT FROM 'accepted'
           AND research_status IS DISTINCT FROM 're_enrolled'
           AND ($3::int IS NULL OR confidence <= $3)
           AND ($4::int IS NULL OR settled_tier <= $4)`,
        [uploadId, userEmail, maxConfidence, tierLte],
      );
      return res.rowCount ?? 0;
    });

    return NextResponse.json(
      action === 'withdraw' ? { withdrawn: count } : { re_enrolled: count },
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const detail = error instanceof Error ? error.message : 'Re-enroll failed';
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
