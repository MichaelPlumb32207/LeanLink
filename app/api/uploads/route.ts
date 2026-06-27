import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { parseFlVoterFile, DEFAULT_LEANLINK_FILTER } from '@/lib/fl-voter-registration';
import {
  buildHistorySummaryMap,
  type BallotFavors,
  type VoterHistorySummary,
} from '@/lib/fl-voter-history';
import { hashVoterPii } from '@/lib/hash';

export const maxDuration = 120;

function parseBallotFavors(value: FormDataEntryValue | null): BallotFavors {
  return value === 'north' ? 'north' : 'south';
}

export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const formData = await request.formData();
    const file = formData.get('file');
    const historyFile = formData.get('historyFile');
    const ballotFavors = parseBallotFavors(formData.get('ballotFavors'));

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const content = await file.text();
    const records = parseFlVoterFile(content, DEFAULT_LEANLINK_FILTER);

    if (records.length === 0) {
      return NextResponse.json(
        { error: 'No eligible NPA active voters found in file' },
        { status: 400 },
      );
    }

    let historyMap = new Map<string, VoterHistorySummary>();
    let historyFilename: string | null = null;

    if (historyFile instanceof File && historyFile.size > 0) {
      historyFilename = historyFile.name;
      historyMap = buildHistorySummaryMap(await historyFile.text());
    }

    const result = await withUserDb(userEmail, async (client) => {
      const uploadRes = await client.query<{ id: string }>(
        `INSERT INTO voter_uploads (user_id, filename, row_count, status, history_filename, ballot_favors)
         VALUES ($1, $2, $3, 'ready', $4, $5)
         RETURNING id`,
        [userEmail, file.name, records.length, historyFilename, ballotFavors],
      );
      const uploadId = uploadRes.rows[0].id;
      const batchSize = 100;
      let withHistory = 0;

      for (let start = 0; start < records.length; start += batchSize) {
        const chunk = records.slice(start, start + batchSize);
        const values: unknown[] = [];
        const placeholders = chunk.map((record, offset) => {
          const i = start + offset;
          const voterHash = hashVoterPii({
            voterId: record.voterId,
            name: record.name.full,
            address: record.residence.full,
          });
          const historySummary = historyMap.get(record.voterId) ?? null;
          if (historySummary && historySummary.total_events > 0) withHistory += 1;

          const base = values.length;
          values.push(
            uploadId,
            userEmail,
            i,
            JSON.stringify(record),
            voterHash,
            historySummary ? JSON.stringify(historySummary) : null,
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, 'pending')`;
        });

        await client.query(
          `INSERT INTO voter_records
             (upload_id, user_id, row_index, raw_data, voter_hash, history_summary, status)
           VALUES ${placeholders.join(', ')}`,
          values,
        );
      }

      return {
        uploadId,
        rowCount: records.length,
        historyAttached: !!historyFilename,
        votersWithHistory: withHistory,
        ballotFavors,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Upload failed', error);
    const detail = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;

    const { rows } = await withUserDb(userEmail, (client) =>
      client.query(
        `SELECT id, filename, row_count, status, history_filename, ballot_favors, created_at
         FROM voter_uploads
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [userEmail],
      ),
    );

    return NextResponse.json({ uploads: rows });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to list uploads' }, { status: 500 });
  }
}