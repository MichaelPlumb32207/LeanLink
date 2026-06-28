import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import {
  buildResultsSql,
  parseColumnFilters,
  parseSortColumn,
  parseSortDirection,
} from '@/lib/results-query';

export async function GET(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { uploadId } = await context.params;
    const { searchParams } = new URL(request.url);

    const sortColumn = parseSortColumn(searchParams.get('sort'));
    const sortDirection = parseSortDirection(searchParams.get('order'));
    const filters = parseColumnFilters(searchParams);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : 1000;

    const sql = buildResultsSql({
      uploadId,
      userEmail,
      sortColumn,
      sortDirection,
      filters,
      limit,
    });

    const { rows, total, filtered } = await withUserDb(userEmail, async (client) => {
      const [countAll, countFiltered, results] = await Promise.all([
        client.query(
          `SELECT COUNT(*)::int AS count
           FROM lean_results r
           WHERE r.upload_id = $1 AND r.user_id = $2`,
          [uploadId, userEmail],
        ),
        client.query(
          `SELECT COUNT(*)::int AS count
           FROM lean_results r
           JOIN voter_records vr ON vr.id = r.voter_record_id
           WHERE ${sql.whereSql}`,
          sql.params,
        ),
        client.query(
          `SELECT r.*, vr.raw_data, vr.row_index
           FROM lean_results r
           JOIN voter_records vr ON vr.id = r.voter_record_id
           WHERE ${sql.whereSql}
           ORDER BY ${sql.orderSql}
           LIMIT $${sql.params.length + 1}`,
          [...sql.params, sql.limit],
        ),
      ]);

      return {
        rows: results.rows,
        total: countAll.rows[0]?.count ?? 0,
        filtered: countFiltered.rows[0]?.count ?? 0,
      };
    });

    return NextResponse.json({ results: rows, total, filtered });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 });
  }
}