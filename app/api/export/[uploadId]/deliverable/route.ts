import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import {
  DEFAULT_LEAN_PRECEDENCE,
  parseLeanPrecedence,
  resolveDeliverableLean,
  type LeanPrecedenceMode,
} from '@/lib/lean-precedence';
import type { VoterHistorySummary } from '@/lib/fl-voter-history';
import {
  HISTORY_EXPORT_HEADERS,
  historyExportRow,
} from '@/lib/history/export-fields';

/**
 * Default: **client deliverable** (D-042 layers 1–2) — submitted list echoed back with
 * lean, confidence, source arm *labels*, review status, and short evidence headlines.
 *
 * Lean is resolved under the upload's **lean_precedence** (D-044): when registration
 * party and public-evidence lean disagree, default **wallet** (evidence wins). Does not
 * rewrite fusion rows — presentation only. Researcher-**accepted** rows keep the frozen
 * fusion lean as-is.
 *
 * `?format=audit` — **operator-internal** full provenance ledger (D-042 layer 4): one row
 * per evidence event (arm, source, identity band, lean signal, headlines, URLs). Safe to
 * screen-share for trust; not the standard client handoff (exposes methods/pipeline detail).
 * Prefer sanitized source-class language if a client needs more than labels (layer 3).
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
  turnout: 'Turnout (history)',
  street_view: 'Street View',
  human_judgment: 'Researcher judgment',
};

const APPENDED = [
  'LeanLink Lean',
  'LeanLink Confidence',
  'LeanLink Source',
  'LeanLink Status',
  'LeanLink Evidence',
  ...HISTORY_EXPORT_HEADERS,
] as const;

const EVIDENCE_HEADLINES = 3;

interface SourceCol {
  h: string;
  v: string;
}

interface Row {
  raw_data: ParsedFlVoterRecord & { _source?: SourceCol[]; party?: string };
  history_summary: VoterHistorySummary | null;
  lean: string | null;
  confidence: number | null;
  fusion_status: string | null;
  review_status: string | null;
  settled_arm: string | null;
  contributing_arms: unknown;
  evidence_summary: unknown;
}

/** Deliverable lean/confidence under precedence; accepted freezes fusion values. */
function deliverableLeanFields(
  row: Row,
  precedence: LeanPrecedenceMode,
): { lean: string; confidence: number; reason: string | null; tension: boolean } {
  if (row.review_status === 'accepted' && row.lean) {
    return {
      lean: row.lean,
      confidence: row.confidence ?? 0,
      reason: null,
      tension: false,
    };
  }
  const resolved = resolveDeliverableLean({
    party: row.raw_data?.party,
    evidenceLean: row.lean,
    evidenceConfidence: row.confidence,
    precedence,
  });
  return {
    lean: resolved.lean,
    confidence: resolved.confidence,
    reason: resolved.tension || resolved.winner === 'registration' ? resolved.reason : null,
    tension: resolved.tension,
  };
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

const armLabel = (arm: string): string => ARM_LABEL[arm] ?? arm;

/** Every arm that fed the fused lean, settled (billed) arm first. */
function sourceLabel(row: Row): string {
  const arms = Array.isArray(row.contributing_arms) ? (row.contributing_arms as string[]) : [];
  const ordered = row.settled_arm
    ? [row.settled_arm, ...arms.filter((a) => a !== row.settled_arm)]
    : arms;
  return ordered.map(armLabel).join(' + ');
}

/** Researcher acceptance outranks the automated fusion status. */
function statusLabel(row: Row): string {
  if (row.review_status === 'accepted') return 'accepted';
  if (!row.lean) return 'unresearched';
  return row.fusion_status ?? 'undetermined';
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvResponse(header: string[], lines: string[][], filename: string): NextResponse {
  const csv = [header.map(csvCell).join(','), ...lines.map((l) => l.map(csvCell).join(','))].join('\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

interface AuditRow {
  row_index: number;
  raw_data: ParsedFlVoterRecord;
  arm: string;
  source: string;
  identity_band: string | null;
  probable_same_person: boolean;
  lean_signal: string | null;
  lean_confidence: number | null;
  evidence: unknown;
  urls: unknown;
  created_at: string;
}

async function auditExport(uploadId: string, userEmail: string): Promise<NextResponse> {
  const { rows } = await withUserDb(userEmail, (client) =>
    client.query<AuditRow>(
      `SELECT vr.row_index, vr.raw_data,
              e.arm, e.source, e.identity_band, e.probable_same_person,
              e.lean_signal, e.lean_confidence, e.evidence, e.urls, e.created_at
       FROM evidence_events e
       JOIN voter_records vr ON vr.id = e.voter_record_id
       WHERE e.upload_id = $1 AND e.user_id = $2
       ORDER BY vr.row_index ASC, e.created_at ASC`,
      [uploadId, userEmail],
    ),
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No evidence events for this upload' }, { status: 404 });
  }

  const header = [
    'Row',
    'Name',
    'Arm',
    'Source',
    'Identity Band',
    'Probable Match',
    'Lean Signal',
    'Signal Confidence',
    'Evidence',
    'URLs',
    'Recorded At',
  ];
  const lines = rows.map((r) => [
    r.row_index,
    r.raw_data.name?.full ?? '',
    armLabel(r.arm),
    r.source,
    r.identity_band ?? '',
    r.probable_same_person ? 'yes' : 'no',
    r.lean_signal ?? '',
    r.lean_confidence ?? '',
    (Array.isArray(r.evidence) ? r.evidence.map(String) : []).join(' | '),
    (Array.isArray(r.urls) ? r.urls.map(String) : []).join(' '),
    r.created_at,
  ]) as unknown as string[][];

  return csvResponse(header, lines, `leanlink-audit-${uploadId}.csv`);
}

export async function GET(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { uploadId } = await context.params;
    const format = new URL(request.url).searchParams.get('format') ?? 'csv';

    if (format === 'audit') {
      return await auditExport(uploadId, userEmail);
    }

    const { rows, precedence } = await withUserDb(userEmail, async (client) => {
      const uploadRes = await client.query<{ lean_precedence: string | null }>(
        `SELECT lean_precedence FROM voter_uploads WHERE id = $1 AND user_id = $2`,
        [uploadId, userEmail],
      );
      if (uploadRes.rowCount === 0) {
        return { rows: [] as Row[], precedence: DEFAULT_LEAN_PRECEDENCE };
      }
      const mode = parseLeanPrecedence(
        uploadRes.rows[0]?.lean_precedence ?? DEFAULT_LEAN_PRECEDENCE,
      );
      const recs = await client.query<Row>(
        `SELECT vr.raw_data,
                vr.history_summary,
                f.lean, f.confidence, f.fusion_status, f.review_status,
                f.settled_arm, f.contributing_arms, f.evidence_summary
         FROM voter_records vr
         LEFT JOIN voter_lean_fusion f ON f.voter_record_id = vr.id
         WHERE vr.upload_id = $1 AND vr.user_id = $2
         ORDER BY vr.row_index ASC`,
        [uploadId, userEmail],
      );
      return { rows: recs.rows, precedence: mode };
    });

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
      const resolved = deliverableLeanFields(row, precedence);
      const evidenceParts = [
        ...(resolved.reason ? [resolved.reason] : []),
        ...evidence.slice(0, EVIDENCE_HEADLINES),
      ].slice(0, EVIDENCE_HEADLINES + (resolved.reason ? 1 : 0));
      // When only registration prior contributes, source says so (not empty).
      let source = sourceLabel(row);
      if (!source && resolved.lean !== 'Undetermined') {
        source = ARM_LABEL.party_prior;
      }
      const historyCells = historyExportRow(row.history_summary);
      return {
        original: templateCols.map((h) => byHeader.get(h) ?? ''),
        appended: [
          resolved.lean,
          resolved.confidence,
          source,
          statusLabel(row),
          evidenceParts.join(' | '),
          ...historyCells,
        ],
        meta: {
          lean_tension: resolved.tension,
          lean_precedence: precedence,
        },
      };
    });

    if (format === 'json') {
      const results = enriched.map((e) => {
        const obj: Record<string, unknown> = {};
        templateCols.forEach((h, i) => (obj[h] = e.original[i]));
        APPENDED.forEach((h, i) => (obj[h] = e.appended[i]));
        obj['LeanLink Tension'] = e.meta.lean_tension;
        obj['LeanLink Precedence'] = e.meta.lean_precedence;
        return obj;
      });
      return NextResponse.json({
        upload_id: uploadId,
        lean_precedence: precedence,
        count: results.length,
        results,
      });
    }

    return csvResponse(
      [...templateCols, ...APPENDED],
      enriched.map((e) => [...e.original, ...e.appended]) as unknown as string[][],
      `leanlink-deliverable-${uploadId}.csv`,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Deliverable export failed' }, { status: 500 });
  }
}
