import { NextResponse } from 'next/server';
import { withUserDb } from '@/lib/db';
import { finishArmRun, heartbeatArmRun } from '@/lib/evidence/arm-runs';
import {
  listPendingRefusionCommittees,
  refusionFlContribForCommittee,
} from '@/lib/committee-lean/refusion';
import { getRefuseDeadlineMs, triggerRefuseWorker } from '@/lib/committee-lean/refuse-runner';

// Background "Re-fuse now" worker (D-039). Processes the labeled-but-unfused
// committees for one arm_run single-pass, committing + heartbeating per committee
// so the box score shows live progress; self-chains if it nears the budget.
// Meta (`processed_committees`) is written on EVERY heartbeat so a hard kill
// mid-segment is resume-safe on the next chain / re-trigger of the same runId.
export const maxDuration = 800;

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  return token === process.env.INTERNAL_JOB_SECRET;
}

type RunRow = {
  upload_id: string | null;
  user_id: string;
  status: string;
  processed_count: number;
  meta: { processed_committees?: string[] } | null;
};

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { runId } = await context.params;
  const userEmail = process.env.ALLOWED_USER_EMAIL!;
  const deadline = getRefuseDeadlineMs();

  const run = await withUserDb(userEmail, async (client) => {
    const res = await client.query<RunRow>(
      `SELECT upload_id, user_id, status, processed_count, meta FROM arm_runs WHERE id = $1`,
      [runId],
    );
    return res.rows[0] ?? null;
  });
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  if (run.status !== 'running') return NextResponse.json({ ok: true, note: 'run not active' });

  // Skip committees already handled by an earlier chain of this run (resume-safe;
  // also avoids looping on a genuinely-conflicted committee that stays pending).
  const done = new Set(run.meta?.processed_committees ?? []);
  let refused = run.processed_count;

  try {
    const pending = await withUserDb(userEmail, (client) =>
      listPendingRefusionCommittees(client, { user_id: run.user_id, upload_id: run.upload_id }),
    );
    const todo = pending.filter((c) => !done.has(c));

    for (const committee_name of todo) {
      // Check budget BEFORE starting work so a large committee never starts past
      // the deadline (meta already has prior committees from the last heartbeat).
      if (Date.now() > deadline) {
        void triggerRefuseWorker(runId);
        return NextResponse.json({ ok: true, refused, chained: true });
      }
      try {
        const out = await withUserDb(userEmail, (client) =>
          refusionFlContribForCommittee(client, {
            user_id: run.user_id,
            committee_name,
            upload_id: run.upload_id,
          }),
        );
        refused += out.voters_refused;
      } catch (e) {
        console.error('refuse committee failed', committee_name, e);
      }
      done.add(committee_name); // mark processed even on failure — never retry-loop
      // Maintenance arm (not a scoring funnel): only `processed` carries meaning
      // (voters re-fused). Persist processed_committees on every heartbeat so a
      // hard kill / maxDuration cut mid-segment is resume-safe without a chain write.
      await withUserDb(userEmail, (client) =>
        heartbeatArmRun(
          client,
          runId,
          {
            processed: refused,
            hits: 0,
            confirmed: 0,
            leanSignals: 0,
          },
          { meta: { processed_committees: [...done] } },
        ),
      );
    }

    await withUserDb(userEmail, (client) => finishArmRun(client, runId, 'completed'));
    return NextResponse.json({ ok: true, refused, chained: false });
  } catch (e) {
    await withUserDb(userEmail, (client) =>
      finishArmRun(client, runId, 'failed', e instanceof Error ? e.message : 'refuse worker error'),
    ).catch(() => {});
    return NextResponse.json({ error: 'refuse worker failed' }, { status: 500 });
  }
}
