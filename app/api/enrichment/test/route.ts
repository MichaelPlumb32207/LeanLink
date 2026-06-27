import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { buildEnrichmentBundle } from '@/lib/enrichment/build-bundle';
import { parseEnrichmentMode, type EnrichmentMode } from '@/lib/enrichment/modes';
import { runEnrichmentPipeline } from '@/lib/enrichment/grok-pipeline';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import { getXaiApiKey } from '@/lib/xai/client';

function formatTestResponse(
  rowId: string,
  bundle: ReturnType<typeof buildEnrichmentBundle>,
  mode: EnrichmentMode,
  result: Awaited<ReturnType<typeof runEnrichmentPipeline>>,
) {
  return {
    mode,
    voterRecordId: rowId,
    bundle,
    urls_searched: result.enrichment.citations,
    search_queries: result.enrichment.search_queries,
    usage: result.debug?.usage ?? null,
    result: {
      identity_resolution_status: result.enrichment.identity_resolution_status,
      identity_best_match_score: result.enrichment.identity_best_match_score,
      identity_matches: result.enrichment.identity_matches,
      lean_signals_found: result.enrichment.lean_signals_found,
      lean: result.lean,
      confidence: result.confidence,
      evidence: result.evidence,
      matched_social: result.matched_social,
      enrichment: result.enrichment,
      audit: result.audit,
    },
    debug: result.debug,
  };
}

export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const body = (await request.json()) as {
      uploadId?: string;
      voterRecordId?: string;
      rowIndex?: number;
      mode?: EnrichmentMode;
      compare?: boolean;
    };

    if (!body.uploadId) {
      return NextResponse.json({ error: 'uploadId is required' }, { status: 400 });
    }

    if (!getXaiApiKey()) {
      return NextResponse.json(
        {
          error: 'XAI_API_KEY is not configured',
          hint: 'Add XAI_API_KEY to Vercel env to run live Grok OSINT tests.',
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

    if (body.compare) {
      const modes: EnrichmentMode[] = ['grok-full', 'modular-targeted', 'modular-synthesize'];
      const comparison: Record<string, ReturnType<typeof formatTestResponse>> = {};
      for (const mode of modes) {
        const result = await runEnrichmentPipeline(bundle, mode, { includeDebug: true });
        comparison[mode] = formatTestResponse(row.id, bundle, mode, result);
      }
      return NextResponse.json({
        compare: true,
        voterRecordId: row.id,
        bundle,
        comparison,
      });
    }

    const mode = parseEnrichmentMode(body.mode);
    const result = await runEnrichmentPipeline(bundle, mode, { includeDebug: true });
    return NextResponse.json(formatTestResponse(row.id, bundle, mode, result));
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Enrichment test failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}