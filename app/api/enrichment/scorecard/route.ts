import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { buildEnrichmentBundle } from '@/lib/enrichment/build-bundle';
import { parseEnrichmentMode, type EnrichmentMode } from '@/lib/enrichment/modes';
import { runEnrichmentPipeline } from '@/lib/enrichment/grok-pipeline';
import {
  buildFailedScorecardRow,
  buildScorecardRow,
  computeScorecardMetrics,
  defaultScorecardRowIndices,
  type EnrichmentScorecard,
} from '@/lib/enrichment/scorecard';
import { suggestedTestRowsForFilename } from '@/lib/enrichment/suggested-test-rows';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import { getXaiApiKey } from '@/lib/xai/client';

async function fetchRowByIndex(
  userEmail: string,
  uploadId: string,
  rowIndex: number,
) {
  return withUserDb(userEmail, async (client) => {
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
      [uploadId, userEmail, rowIndex],
    );
    return res.rows[0] ?? null;
  });
}

export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const body = (await request.json()) as {
      uploadId?: string;
      mode?: EnrichmentMode;
      rowIndices?: number[];
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

    const uploadMeta = await withUserDb(userEmail, async (client) => {
      const res = await client.query<{ filename: string }>(
        `SELECT filename FROM voter_uploads WHERE id = $1 AND user_id = $2`,
        [body.uploadId, userEmail],
      );
      return res.rows[0] ?? null;
    });

    if (!uploadMeta) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    const scenarioRows = suggestedTestRowsForFilename(uploadMeta.filename);
    const mode = parseEnrichmentMode(body.mode);
    const rowIndices =
      body.rowIndices && body.rowIndices.length > 0
        ? body.rowIndices
        : defaultScorecardRowIndices(uploadMeta.filename);

    const scorecardRows = [];

    for (const rowIndex of rowIndices) {
      try {
        const row = await fetchRowByIndex(userEmail, body.uploadId!, rowIndex);
        if (!row) {
          scorecardRows.push(
            buildFailedScorecardRow(rowIndex, 'Voter record not found', scenarioRows),
          );
          continue;
        }

        const bundle = buildEnrichmentBundle(
          row.raw_data,
          row.history_summary,
          row.ballot_favors,
        );
        const pipeline = await runEnrichmentPipeline(bundle, mode, { includeDebug: true });

        scorecardRows.push(
          buildScorecardRow(
            rowIndex,
            row.id,
            {
              identity_resolution_status: pipeline.enrichment.identity_resolution_status,
              identity_best_match_score: pipeline.enrichment.identity_best_match_score,
              identity_matches: pipeline.enrichment.identity_matches,
              lean_signals_found: pipeline.enrichment.lean_signals_found,
              lean: pipeline.lean,
              matched_social: pipeline.matched_social,
            },
            pipeline.debug?.usage ?? null,
            scenarioRows,
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Enrichment failed';
        scorecardRows.push(buildFailedScorecardRow(rowIndex, message, scenarioRows));
      }
    }

    const failed = scorecardRows.filter((r) => r.error).length;
    const scorecard: EnrichmentScorecard = {
      mode,
      upload_id: body.uploadId,
      row_count: rowIndices.length,
      completed: scorecardRows.length - failed,
      failed,
      metrics: computeScorecardMetrics(scorecardRows),
      rows: scorecardRows,
    };

    return NextResponse.json(scorecard);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Scorecard failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}