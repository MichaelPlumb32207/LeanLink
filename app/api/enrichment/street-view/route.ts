import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { buildEnrichmentBundle } from '@/lib/enrichment/build-bundle';
import { runStreetViewVisionTest } from '@/lib/enrichment/street-view-vision';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import { getGoogleMapsApiKey } from '@/lib/google/street-view';
import { getXaiApiKey } from '@/lib/xai/client';

export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const body = (await request.json()) as {
      uploadId?: string;
      voterRecordId?: string;
      rowIndex?: number;
    };

    if (!body.uploadId) {
      return NextResponse.json({ error: 'uploadId is required' }, { status: 400 });
    }

    if (!getXaiApiKey()) {
      return NextResponse.json(
        {
          error: 'XAI_API_KEY is not configured',
          hint: 'Add XAI_API_KEY to Vercel env to run Street View vision tests.',
        },
        { status: 503 },
      );
    }

    if (!getGoogleMapsApiKey()) {
      return NextResponse.json(
        {
          error: 'GOOGLE_MAPS_API_KEY is not configured',
          hint: 'Enable Street View Static API and add GOOGLE_MAPS_API_KEY to Vercel env.',
        },
        { status: 503 },
      );
    }

    const row = await withUserDb(userEmail, async (client) => {
      if (body.voterRecordId) {
        const res = await client.query<{
          id: string;
          raw_data: ParsedFlVoterRecord;
          history_summary: VoterHistorySummary | null;
          ballot_favors: BallotFavors;
        }>(
          `SELECT vr.id, vr.raw_data, vr.history_summary, u.ballot_favors
           FROM voter_records vr
           JOIN voter_uploads u ON u.id = vr.upload_id
           WHERE vr.id = $1 AND vr.upload_id = $2 AND vr.user_id = $3`,
          [body.voterRecordId, body.uploadId, userEmail],
        );
        return res.rows[0] ?? null;
      }

      const res = await client.query<{
        id: string;
        raw_data: ParsedFlVoterRecord;
        history_summary: VoterHistorySummary | null;
        ballot_favors: BallotFavors;
      }>(
        `SELECT vr.id, vr.raw_data, vr.history_summary, u.ballot_favors
         FROM voter_records vr
         JOIN voter_uploads u ON u.id = vr.upload_id
         WHERE vr.upload_id = $1 AND vr.user_id = $2
         ORDER BY vr.row_index ASC
         OFFSET $3
         LIMIT 1`,
        [body.uploadId, userEmail, body.rowIndex ?? 0],
      );
      return res.rows[0] ?? null;
    });

    if (!row) {
      return NextResponse.json({ error: 'Voter record not found' }, { status: 404 });
    }

    const bundle = buildEnrichmentBundle(row.raw_data, row.history_summary, row.ballot_favors);

    if (!bundle.residence_on_file.has_usable_address) {
      return NextResponse.json({
        test: 'street-view-vision',
        voterRecordId: row.id,
        bundle,
        street_view_vision: {
          status: 'no_address',
          address_used: null,
          lean_street_view: 'Undetermined',
          lean_street_view_confidence: 0,
          methodology_note:
            'Experimental Street View vision lean — NOT merged into main OSINT lean.',
        },
      });
    }

    const street_view_vision = await runStreetViewVisionTest(bundle);

    return NextResponse.json({
      test: 'street-view-vision',
      voterRecordId: row.id,
      bundle,
      street_view_vision,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Street View vision test failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}