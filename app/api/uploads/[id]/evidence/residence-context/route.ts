import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import {
  googleMapsSearchUrl,
  googleStreetViewUrl,
} from '@/lib/evidence/human-judgment';
import {
  fetchStreetViewImage,
  formatResidenceAddress,
  streetViewImageDataUrl,
} from '@/lib/google/street-view';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: uploadId } = await context.params;
    const { searchParams } = new URL(request.url);
    const voterRecordId = searchParams.get('voterRecordId');

    if (!voterRecordId) {
      return NextResponse.json({ error: 'voterRecordId is required' }, { status: 400 });
    }

    const result = await withUserDb(userEmail, async (client) => {
      const res = await client.query<{ raw_data: ParsedFlVoterRecord }>(
        `SELECT raw_data FROM voter_records
         WHERE id = $1 AND upload_id = $2 AND user_id = $3`,
        [voterRecordId, uploadId, userEmail],
      );
      const row = res.rows[0];
      if (!row) return null;

      const residence = row.raw_data.residence;
      const address = formatResidenceAddress(residence);
      const fetch = address ? await fetchStreetViewImage(residence) : null;

      return {
        address,
        maps_search_url: address ? googleMapsSearchUrl(address) : null,
        street_view_url: address ? googleStreetViewUrl(address) : null,
        street_view: fetch
          ? {
              status: fetch.status,
              address_used: fetch.address_used,
              image_data_url:
                fetch.status === 'ok' && fetch.image_bytes
                  ? streetViewImageDataUrl(fetch.image_bytes)
                  : null,
              error_message: fetch.error_message ?? null,
            }
          : {
              status: 'no_address' as const,
              address_used: null,
              image_data_url: null,
              error_message: null,
            },
      };
    });

    if (!result) {
      return NextResponse.json({ error: 'Voter not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Failed to load residence context';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}