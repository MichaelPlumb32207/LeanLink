import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { lookupFecForVoter } from '@/lib/fec/lookup-voter';
import { defaultScorecardRowIndices } from '@/lib/enrichment/scorecard';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

async function fetchRowByIndex(
  userEmail: string,
  uploadId: string,
  rowIndex: number,
) {
  return withUserDb(userEmail, async (client) => {
    const res = await client.query<{
      id: string;
      row_index: number;
      raw_data: ParsedFlVoterRecord;
    }>(
      `SELECT vr.id, vr.row_index, vr.raw_data
       FROM voter_records vr
       WHERE vr.upload_id = $1 AND vr.user_id = $2
       ORDER BY vr.row_index ASC
       OFFSET $3
       LIMIT 1`,
      [uploadId, userEmail, rowIndex],
    );
    return res.rows[0] ?? null;
  });
}

export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const body = (await request.json()) as {
      uploadId?: string;
      rowIndices?: number[];
    };

    if (!body.uploadId) {
      return NextResponse.json({ error: 'uploadId is required' }, { status: 400 });
    }

    const uploadMeta = await withUserDb(userEmail, async (client) => {
      const res = await client.query<{ filename: string }>(
        `SELECT filename FROM voter_uploads WHERE id = $1 AND user_id = $2`,
        [body.uploadId, userEmail],
      );
      return res.rows[0] ?? null;
    });

    if (!uploadMeta) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    const rowIndices =
      body.rowIndices && body.rowIndices.length > 0
        ? body.rowIndices
        : defaultScorecardRowIndices(uploadMeta.filename);

    const rows = [];

    for (const rowIndex of rowIndices) {
      const row = await fetchRowByIndex(userEmail, body.uploadId, rowIndex);
      if (!row) {
        rows.push({
          rowIndex,
          voterRecordId: null,
          name: null,
          city: null,
          error: 'Voter record not found',
          lookup: null,
        });
        continue;
      }

      const fecLookup = await lookupFecForVoter(row.raw_data);
      const lookup = {
        ...fecLookup.lookup,
        contributions: fecLookup.contributions,
      };

      rows.push({
        rowIndex,
        voterRecordId: row.id,
        name: row.raw_data.name.full,
        city: row.raw_data.residence.city,
        names_tried: fecLookup.names_tried,
        variant_used: fecLookup.variant_used,
        error: lookup.error ?? null,
        lookup,
      });
    }

    const withHits = rows.filter((r) => (r.lookup?.contributions.length ?? 0) > 0).length;

    return NextResponse.json({
      upload_id: body.uploadId,
      row_count: rowIndices.length,
      rows_with_hits: withHits,
      rows,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'FEC lookup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}