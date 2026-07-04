import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

/**
 * Client deliverable: the submitted list echoed back with our lean estimate,
 * confidence, source arm, and headline evidence appended to every row (including
 * Undetermined ones), in the original row order.
 *
 * Prefers the client's original columns (captured at intake as `raw_data._source`);
 * falls back to the normalized fields for uploads ingested before that was stored.
 */
const ARM_LABEL: Record<string, string> = {
  fec: 'FEC federal',
  fl_contrib: 'FL contributor',
  sunbiz: 'Sunbiz → entity',
  osint: 'OSINT',
  local_media: 'Local media',
  civic: 'Civic',
  household: 'Household',
  party_prior: 'Party (provided)',
};

const APPENDED = [
  'LeanLink Lean',
  'LeanLink Confidence',
  'LeanLink Source',
  'LeanLink Evidence',
] as const;

interface SourceCol {
  h: string;
  v: string;
}

interface Row {
  raw_data: ParsedFlVoterRecord & { _source?: SourceCol[] };
  lean: string | null;
  confidence: number | null;
  settled_arm: string | null;
  contributing_arms: unknown;
  evidence_summary: unknown;
}

function fallbackColumns(raw: ParsedFlVoterRecord): SourceCol[] {
  return [
    { h: 'name', v: raw.name?.full ?? '' },
    { h: 'county', v: raw.countyCode ?? '' },
    { h: 'address', v: raw.residence?.line1 ?? '' },
    { h: 'city', v: raw.residence?.city ?? '' },
    { h: 'state', v: raw.residence?.state ?? '' },
    { h: 'zip', v: raw.residence?.zip ?? '' },
    { h: 'dob', v: raw.birthDate ?? '' },
    { h: 'email', v: raw.email ?? '' },
  ];
}

function sourceLabel(row: Row): string {
  if (row.settled_arm) return ARM_LABEL[row.settled_arm] ?? row.settled_arm;
  const arms = Array.isArray(row.contributing_arms) ? (row.contributing_arms as string[]) : [];
  if (arms.length) return ARM_LABEL[arms[0]] ?? arms[0];
  return '';
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { uploadId } = await context.params;
    const format = new URL(request.url).searchParams.get('format') ?? 'csv';

    const { rows } = await withUserDb(userEmail, (client) =>
      client.query<Row>(
        `SELECT vr.raw_data,
                f.lean, f.confidence, f.settled_arm, f.contributing_arms, f.evidence_summary
         FROM voter_records vr
         LEFT JOIN voter_lean_fusion f ON f.voter_record_id = vr.id
         WHERE vr.upload_id = $1 AND vr.user_id = $2
         ORDER BY vr.row_index ASC`,
        [uploadId, userEmail],
      ),
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No records for this upload' }, { status: 404 });
    }

    // Column template from the first row's original headers (fallback if absent).
    const first = rows[0].raw_data;
    const templateCols = (first._source && first._source.length
      ? first._source
      : fallbackColumns(first)
    ).map((c) => c.h);

    const enriched = rows.map((row) => {
      const src = row.raw_data._source?.length ? row.raw_data._source : fallbackColumns(row.raw_data);
      const byHeader = new Map(src.map((c) => [c.h, c.v]));
      const evidence = Array.isArray(row.evidence_summary) ? (row.evidence_summary as string[]) : [];
      return {
        original: templateCols.map((h) => byHeader.get(h) ?? ''),
        appended: [
          row.lean ?? 'Undetermined',
          row.confidence ?? 0,
          sourceLabel(row),
          evidence[0] ?? '',
        ],
      };
    });

    if (format === 'json') {
      const results = enriched.map((e) => {
        const obj: Record<string, unknown> = {};
        templateCols.forEach((h, i) => (obj[h] = e.original[i]));
        APPENDED.forEach((h, i) => (obj[h] = e.appended[i]));
        return obj;
      });
      return NextResponse.json({ upload_id: uploadId, count: results.length, results });
    }

    const header = [...templateCols, ...APPENDED].map(csvCell).join(',');
    const lines = enriched.map((e) => [...e.original, ...e.appended].map(csvCell).join(','));
    const csv = [header, ...lines].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="leanlink-deliverable-${uploadId}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Deliverable export failed' }, { status: 500 });
  }
}
