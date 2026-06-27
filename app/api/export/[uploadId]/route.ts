import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';

export async function GET(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { uploadId } = await context.params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') ?? 'json';

    const { rows } = await withUserDb(userEmail, (client) =>
      client.query(
        `SELECT r.lean, r.confidence, r.evidence, r.matched_social, r.audit_log, r.voter_hash, vr.raw_data
         FROM lean_results r
         JOIN voter_records vr ON vr.id = r.voter_record_id
         WHERE r.upload_id = $1 AND r.user_id = $2
         ORDER BY r.created_at ASC`,
        [uploadId, userEmail],
      ),
    );

    if (format === 'csv') {
      const header = ['voter_hash', 'lean', 'confidence', 'city', 'precinct', 'evidence'];
      const lines = rows.map((row) => {
        const raw = row.raw_data as { residence?: { city?: string }; precinct?: string };
        const evidence = Array.isArray(row.evidence)
          ? row.evidence.join(' | ')
          : JSON.stringify(row.evidence);
        return [
          row.voter_hash,
          row.lean,
          row.confidence,
          raw?.residence?.city ?? '',
          raw?.precinct ?? '',
          `"${String(evidence).replaceAll('"', '""')}"`,
        ].join(',');
      });

      const csv = [header.join(','), ...lines].join('\n');
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="leanlink-${uploadId}.csv"`,
        },
      });
    }

    return NextResponse.json({ results: rows });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}