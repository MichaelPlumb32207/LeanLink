import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import {
  fuseAndPersistVoter,
  getUploadEvidenceSummary,
  listEvidenceForVoter,
} from '@/lib/evidence/ledger';
import { syncAnchorProfilesToLedger } from '@/lib/anchor/sync-ledger';
import { syncFecSweepToEvidenceLedger } from '@/lib/evidence/sync-fec';
import { fuseEvidenceEvents } from '@/lib/evidence/fusion';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: uploadId } = await context.params;
    const { searchParams } = new URL(request.url);
    const rowIndex = searchParams.get('rowIndex');
    const voterRecordId = searchParams.get('voterRecordId');
    const list = searchParams.get('list') === '1';

    const data = await withUserDb(userEmail, async (client) => {
      if (list) {
        const limit = Math.min(Number(searchParams.get('limit') ?? 500), 2000);
        const nameFilter = searchParams.get('name')?.trim();

        const params: (string | number)[] = [uploadId, userEmail];
        let nameSql = '';
        if (nameFilter) {
          params.push(`%${nameFilter}%`);
          nameSql = ` AND vr.raw_data->'name'->>'full' ILIKE $${params.length}`;
        }
        params.push(limit);

        const res = await client.query(
          `SELECT vr.id, vr.row_index, vr.raw_data,
                  vlf.lean, vlf.confidence, vlf.fusion_status, vlf.contributing_arms,
                  (SELECT COUNT(*)::int FROM evidence_events ee WHERE ee.voter_record_id = vr.id) AS event_count,
                  (SELECT BOOL_OR(ee.probable_same_person) FROM evidence_events ee WHERE ee.voter_record_id = vr.id AND ee.arm = 'fec') AS fec_confirmed
           FROM voter_records vr
           LEFT JOIN voter_lean_fusion vlf ON vlf.voter_record_id = vr.id
           WHERE vr.upload_id = $1 AND vr.user_id = $2${nameSql}
           ORDER BY vr.row_index
           LIMIT $${params.length}`,
          params,
        );
        return { voters: res.rows };
      }

      let voterQuery;
      if (voterRecordId) {
        voterQuery = await client.query<{
          id: string;
          row_index: number;
          raw_data: ParsedFlVoterRecord;
        }>(
          `SELECT id, row_index, raw_data FROM voter_records
           WHERE id = $1 AND upload_id = $2 AND user_id = $3`,
          [voterRecordId, uploadId, userEmail],
        );
      } else {
        voterQuery = await client.query<{
          id: string;
          row_index: number;
          raw_data: ParsedFlVoterRecord;
        }>(
          `SELECT id, row_index, raw_data FROM voter_records
           WHERE upload_id = $1 AND user_id = $2
           ORDER BY row_index ASC
           OFFSET $3 LIMIT 1`,
          [uploadId, userEmail, Number(rowIndex ?? 0)],
        );
      }

      const voter = voterQuery.rows[0];
      if (!voter) return null;

      const events = await listEvidenceForVoter(client, voter.id);
      const fusion = fuseEvidenceEvents(events);

      const fusionRow = await client.query(
        `SELECT * FROM voter_lean_fusion WHERE voter_record_id = $1`,
        [voter.id],
      );

      return {
        voter: {
          id: voter.id,
          row_index: voter.row_index,
          raw_data: voter.raw_data,
        },
        events,
        fusion,
        fusion_persisted: fusionRow.rows[0] ?? null,
      };
    });

    if (!data) {
      return NextResponse.json({ error: 'Voter not found' }, { status: 404 });
    }

    if ('voters' in data) {
      return NextResponse.json(data);
    }

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Failed to load evidence';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: uploadId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      voterRecordId?: string;
    };

    if (body.action === 'sync-fec') {
      const result = await withUserDb(userEmail, async (client) => {
        const jobRes = await client.query<{ id: string }>(
          `SELECT id FROM fec_sweep_jobs
           WHERE upload_id = $1 AND user_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [uploadId, userEmail],
        );
        const jobId = jobRes.rows[0]?.id;
        if (!jobId) return { error: 'no_fec_job' as const };
        const synced = await syncFecSweepToEvidenceLedger(client, jobId, uploadId, userEmail);
        const summary = await getUploadEvidenceSummary(client, uploadId, userEmail);
        return { synced, summary };
      });

      if ('error' in result && result.error === 'no_fec_job') {
        return NextResponse.json({ error: 'No FEC sweep job for this upload' }, { status: 404 });
      }

      return NextResponse.json(result);
    }

    if (body.action === 'build-anchor') {
      const result = await withUserDb(userEmail, async (client) => {
        const synced = await syncAnchorProfilesToLedger(client, uploadId, userEmail);
        const summary = await getUploadEvidenceSummary(client, uploadId, userEmail);
        return { synced, summary };
      });
      return NextResponse.json(result);
    }

    if (body.action === 'fuse-voter' && body.voterRecordId) {
      const fusion = await withUserDb(userEmail, async (client) => {
        return fuseAndPersistVoter(client, body.voterRecordId!, uploadId, userEmail);
      });
      return NextResponse.json({ fusion });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Evidence action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}