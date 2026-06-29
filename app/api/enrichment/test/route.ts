import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { buildBundleWithAnchorProfile, ensureUploadHouseholdIndex } from '@/lib/anchor/enrichment-context';
import { parseEnrichmentMode, type EnrichmentMode } from '@/lib/enrichment/modes';
import { runEnrichmentPipeline } from '@/lib/enrichment/grok-pipeline';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import type { ApifyPipelineResult } from '@/lib/enrichment/apify-pipeline';
import type { EnrichmentBundle } from '@/lib/enrichment/types';
import { getApifyApiToken } from '@/lib/apify/config';
import { getXaiApiKey } from '@/lib/xai/client';
import { appendEvidenceEvent, fuseAndPersistVoter } from '@/lib/evidence/ledger';
import { buildOsintEvidenceEvent } from '@/lib/evidence/osint-events';

function isApifyResult(
  result: Awaited<ReturnType<typeof runEnrichmentPipeline>>,
): result is ApifyPipelineResult {
  return 'apify_runs' in result && Array.isArray(result.apify_runs);
}

function formatTestResponse(
  rowId: string,
  bundle: EnrichmentBundle,
  mode: EnrichmentMode,
  result: Awaited<ReturnType<typeof runEnrichmentPipeline>>,
) {
  const apify = isApifyResult(result) ? result : null;

  return {
    mode,
    voterRecordId: rowId,
    bundle,
    urls_searched: result.enrichment.citations,
    search_queries: result.enrichment.search_queries,
    usage: result.debug?.usage ?? null,
    apify_runs: apify?.apify_runs ?? null,
    street_view_context: apify?.street_view_context ?? null,
    pipeline_steps: apify?.pipeline_steps ?? null,
    fetched_text_chars: apify?.fetched_text_chars ?? null,
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

    const mode = parseEnrichmentMode(body.mode);

    if (!getXaiApiKey()) {
      return NextResponse.json(
        {
          error: 'XAI_API_KEY is not configured',
          hint: 'Add XAI_API_KEY to Vercel env to run live Grok OSINT tests.',
        },
        { status: 503 },
      );
    }

    const needsApify = mode === 'apify-modular' || body.compare;
    if (needsApify && !getApifyApiToken()) {
      return NextResponse.json(
        {
          error: 'APIFY_API_TOKEN is not configured',
          hint: 'Add APIFY_API_TOKEN to Vercel env. GET /api/enrichment/apify-config lists actor overrides.',
        },
        { status: 503 },
      );
    }

    const prepared = await withUserDb(userEmail, async (client) => {
      type VoterRow = {
        id: string;
        raw_data: ParsedFlVoterRecord;
        history_summary: VoterHistorySummary | null;
        ballot_favors: BallotFavors;
      };
      let row: VoterRow | null = null;

      if (body.voterRecordId) {
        const res = await client.query<VoterRow>(
          `SELECT vr.id, vr.raw_data, vr.history_summary, u.ballot_favors
           FROM voter_records vr
           JOIN voter_uploads u ON u.id = vr.upload_id
           WHERE vr.id = $1 AND vr.upload_id = $2 AND vr.user_id = $3`,
          [body.voterRecordId, body.uploadId, userEmail],
        );
        row = res.rows[0] ?? null;
      } else {
        const res = await client.query<VoterRow>(
          `SELECT vr.id, vr.raw_data, vr.history_summary, u.ballot_favors
           FROM voter_records vr
           JOIN voter_uploads u ON u.id = vr.upload_id
           WHERE vr.upload_id = $1 AND vr.user_id = $2
           ORDER BY vr.row_index ASC
           OFFSET $3
           LIMIT 1`,
          [body.uploadId, userEmail, body.rowIndex ?? 0],
        );
        row = res.rows[0] ?? null;
      }

      if (!row) return null;

      const householdIndex = await ensureUploadHouseholdIndex(
        client,
        body.uploadId!,
        userEmail,
      );
      const bundle = buildBundleWithAnchorProfile(
        row.raw_data,
        row.history_summary,
        row.ballot_favors,
        { voterRecordId: row.id, householdIndex },
      );
      return { row, bundle };
    });

    if (!prepared) {
      return NextResponse.json({ error: 'Voter record not found' }, { status: 404 });
    }

    const { row, bundle } = prepared;

    if (body.compare) {
      const modes: EnrichmentMode[] = [
        'grok-full',
        'apify-modular',
        'modular-targeted',
        'modular-synthesize',
      ];
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

    const result = await runEnrichmentPipeline(bundle, mode, { includeDebug: true });

    await withUserDb(userEmail, async (client) => {
      await appendEvidenceEvent(
        client,
        buildOsintEvidenceEvent({
          upload_id: body.uploadId!,
          voter_record_id: row.id,
          user_id: userEmail,
          mode,
          result,
          cost_usd: result.debug?.usage?.cost_usd ?? null,
        }),
      );
      await fuseAndPersistVoter(client, row.id, body.uploadId!, userEmail);
    });

    return NextResponse.json(formatTestResponse(row.id, bundle, mode, result));
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Enrichment test failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}