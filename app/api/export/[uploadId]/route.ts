import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import type { VoterHistorySummary } from '@/lib/fl-voter-history';
import {
  HISTORY_EXPORT_HEADERS,
  historyExportValues,
} from '@/lib/history/export-fields';

export async function GET(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { uploadId } = await context.params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') ?? 'json';

    const { rows } = await withUserDb(userEmail, (client) =>
      client.query(
        `SELECT r.lean,
                r.confidence,
                r.turnout_propensity,
                r.turnout_score,
                r.primary_engagement,
                r.opposition_mobilization_score,
                r.evidence,
                r.matched_social,
                r.audit_log,
                r.voter_hash,
                vr.raw_data,
                vr.history_summary
         FROM lean_results r
         JOIN voter_records vr ON vr.id = r.voter_record_id
         WHERE r.upload_id = $1 AND r.user_id = $2
         ORDER BY r.created_at ASC`,
        [uploadId, userEmail],
      ),
    );

    if (format === 'csv') {
      const header = [
        'voter_hash',
        'lean',
        'lean_confidence',
        'turnout_propensity',
        'turnout_score',
        'primary_engagement',
        'opposition_mobilization_score',
        'city',
        'precinct',
        'evidence',
        ...HISTORY_EXPORT_HEADERS,
      ];
      const lines = rows.map((row) => {
        const raw = row.raw_data as { residence?: { city?: string }; precinct?: string };
        const evidence = Array.isArray(row.evidence)
          ? row.evidence.join(' | ')
          : JSON.stringify(row.evidence);
        // Prefer live history_summary on the voter; fall back to lean_results copies.
        const hist = (row.history_summary as VoterHistorySummary | null) ?? {
          total_events: row.turnout_score != null ? 1 : 0,
          general_elections_voted: 0,
          general_elections_available: 0,
          primary_elections_voted: 0,
          last_vote_date: null,
          turnout_score: row.turnout_score ?? 0,
          turnout_propensity: row.turnout_propensity ?? 'Low',
          primary_count: 0,
          primary_engagement: row.primary_engagement ?? 'No',
        };
        const h = historyExportValues(
          row.history_summary
            ? (row.history_summary as VoterHistorySummary)
            : row.turnout_propensity != null
              ? hist
              : null,
        );
        return [
          row.voter_hash,
          row.lean,
          row.confidence,
          row.turnout_propensity ?? h['LeanLink Turnout Propensity'],
          row.turnout_score ?? h['LeanLink Turnout Score'],
          row.primary_engagement ?? '',
          row.opposition_mobilization_score ?? '',
          raw?.residence?.city ?? '',
          raw?.precinct ?? '',
          `"${String(evidence).replaceAll('"', '""')}"`,
          ...HISTORY_EXPORT_HEADERS.map((k) => {
            const cell = h[k];
            return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
          }),
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