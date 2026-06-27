import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { parseFlVoterFile, DEFAULT_LEANLINK_FILTER } from '@/lib/fl-voter-registration';
import { hashVoterPii } from '@/lib/hash';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const formData = await request.formData();
    const file = formData.get('file');

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

    const result = await withUserDb(userEmail, async (client) => {
      const uploadRes = await client.query<{ id: string }>(
        `INSERT INTO voter_uploads (user_id, filename, row_count, status)
         VALUES ($1, $2, $3, 'ready')
         RETURNING id`,
        [userEmail, file.name, records.length],
      );
      const uploadId = uploadRes.rows[0].id;

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const voterHash = hashVoterPii({
          voterId: record.voterId,
          name: record.name.full,
          address: record.residence.full,
        });

        await client.query(
          `INSERT INTO voter_records
             (upload_id, user_id, row_index, raw_data, voter_hash, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [uploadId, userEmail, i, JSON.stringify(record), voterHash],
        );
      }

      return { uploadId, rowCount: records.length };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Upload failed', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;

    const { rows } = await withUserDb(userEmail, (client) =>
      client.query(
        `SELECT id, filename, row_count, status, created_at
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