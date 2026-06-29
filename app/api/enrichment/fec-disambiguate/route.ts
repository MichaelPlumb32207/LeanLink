import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { defaultScorecardRowIndices } from '@/lib/enrichment/scorecard';
import type { FecContributionHit } from '@/lib/fec/contributor-lookup';
import { runFecDisambiguatePipeline } from '@/lib/fec/fec-disambiguate-pipeline';
import { lookupFecContributions } from '@/lib/fec/contributor-lookup';
import { scoreFecLookupForVoter } from '@/lib/fec/score-lookup-result';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import { getXaiApiKey } from '@/lib/xai/client';
import { appendEvidenceEvent, fuseAndPersistVoter } from '@/lib/evidence/ledger';
import { buildFecSweepEvidenceEvent } from '@/lib/evidence/fec-events';

interface FecLookupDbRow {
  contributions: FecContributionHit[];
  match_level: 'strict' | 'state_only' | 'none';
  has_hits: boolean;
  identity_band: string | null;
  probable_same_person: boolean | null;
}

async function loadFecFromSweep(
  userEmail: string,
  uploadId: string,
  voterRecordId: string,
): Promise<FecLookupDbRow | null> {
  return withUserDb(userEmail, async (client) => {
    const res = await client.query<FecLookupDbRow>(
      `SELECT flr.contributions, flr.match_level, flr.has_hits, flr.identity_band, flr.probable_same_person
       FROM fec_lookup_results flr
       JOIN fec_sweep_jobs j ON j.id = flr.sweep_job_id
       WHERE flr.upload_id = $1
         AND flr.user_id = $2
         AND flr.voter_record_id = $3
         AND j.status IN ('running', 'completed')
       ORDER BY j.created_at DESC
       LIMIT 1`,
      [uploadId, userEmail, voterRecordId],
    );
    return res.rows[0] ?? null;
  });
}

async function fetchVoterRow(
  userEmail: string,
  uploadId: string,
  voterRecordId?: string,
  rowIndex?: number,
) {
  return withUserDb(userEmail, async (client) => {
    if (voterRecordId) {
      const res = await client.query<{
        id: string;
        row_index: number;
        raw_data: ParsedFlVoterRecord;
        history_summary: VoterHistorySummary | null;
        ballot_favors: BallotFavors;
      }>(
        `SELECT vr.id, vr.row_index, vr.raw_data, vr.history_summary, u.ballot_favors
         FROM voter_records vr
         JOIN voter_uploads u ON u.id = vr.upload_id
         WHERE vr.id = $1 AND vr.upload_id = $2 AND vr.user_id = $3`,
        [voterRecordId, uploadId, userEmail],
      );
      return res.rows[0] ?? null;
    }

    const res = await client.query<{
      id: string;
      row_index: number;
      raw_data: ParsedFlVoterRecord;
      history_summary: VoterHistorySummary | null;
      ballot_favors: BallotFavors;
    }>(
      `SELECT vr.id, vr.row_index, vr.raw_data, vr.history_summary, u.ballot_favors
       FROM voter_records vr
       JOIN voter_uploads u ON u.id = vr.upload_id
       WHERE vr.upload_id = $1 AND vr.user_id = $2
       ORDER BY vr.row_index ASC
       OFFSET $3
       LIMIT 1`,
      [uploadId, userEmail, rowIndex ?? 0],
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
      voterRecordId?: string;
      rowIndex?: number;
      rowIndices?: number[];
      useGrok?: boolean;
      source?: 'sweep' | 'live';
    };

    if (!body.uploadId) {
      return NextResponse.json({ error: 'uploadId is required' }, { status: 400 });
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

    const rowIndices = body.voterRecordId
      ? [body.rowIndex ?? 0]
      : body.rowIndices && body.rowIndices.length > 0
        ? body.rowIndices
        : body.rowIndex !== undefined
          ? [body.rowIndex]
          : defaultScorecardRowIndices(uploadMeta.filename);

    const useGrok = body.useGrok !== false;
    const source = body.source ?? 'sweep';

    const results = [];

    for (const rowIndex of rowIndices) {
      const row = await fetchVoterRow(userEmail, body.uploadId, body.voterRecordId, rowIndex);
      if (!row) {
        results.push({ rowIndex, error: 'Voter record not found' });
        continue;
      }

      let contributions: FecContributionHit[] = [];
      let matchLevel: 'strict' | 'state_only' | 'none' = 'none';
      let fecSource: 'sweep' | 'live' = source;

      if (source === 'sweep') {
        const sweepRow = await loadFecFromSweep(userEmail, body.uploadId, row.id);
        if (sweepRow) {
          contributions = Array.isArray(sweepRow.contributions) ? sweepRow.contributions : [];
          matchLevel = sweepRow.match_level;
        } else {
          fecSource = 'live';
        }
      }

      if (contributions.length === 0 && (source === 'live' || fecSource === 'live')) {
        const strict = await lookupFecContributions({
          name: row.raw_data.name.full,
          city: row.raw_data.residence.city,
          state: row.raw_data.residence.state || 'FL',
          zip: row.raw_data.residence.zip,
          matchLevel: 'strict',
        });
        if (strict.contributions.length > 0) {
          contributions = strict.contributions;
          matchLevel = 'strict';
        } else if (!strict.error) {
          const relaxed = await lookupFecContributions({
            name: row.raw_data.name.full,
            state: row.raw_data.residence.state || 'FL',
            matchLevel: 'state_only',
          });
          contributions = relaxed.contributions;
          matchLevel = relaxed.contributions.length > 0 ? 'state_only' : 'none';
        }
        fecSource = 'live';
      }

      const deterministicOnly = scoreFecLookupForVoter({
        voter: row.raw_data,
        contributions,
        matchLevel: contributions.length > 0 ? matchLevel : 'none',
      });

      const persistFecEvidence = async () => {
        await withUserDb(userEmail, async (client) => {
          await appendEvidenceEvent(
            client,
            buildFecSweepEvidenceEvent({
              upload_id: body.uploadId!,
              voter_record_id: row.id,
              user_id: userEmail,
              voter: row.raw_data,
              scored: deterministicOnly,
              match_level: contributions.length > 0 ? matchLevel : 'none',
              has_hits: contributions.length > 0,
              sweep_job_id: `fec-disambiguate-${row.id}`,
            }),
          );
          await fuseAndPersistVoter(client, row.id, body.uploadId!, userEmail);
        });
      };

      if (!useGrok || !getXaiApiKey()) {
        await persistFecEvidence();
        results.push({
          rowIndex: row.row_index,
          voterRecordId: row.id,
          name: row.raw_data.name.full,
          fec_source: fecSource,
          grok_used: false,
          grok_skip_reason: useGrok ? 'xai_key_missing' : 'useGrok_false',
          deterministic: deterministicOnly,
          result: {
            identity_band: deterministicOnly.identity.identity_band,
            probable_same_person: deterministicOnly.identity.probable_same_person,
            identity_best_score: deterministicOnly.identity.best_score,
            fec_lean: deterministicOnly.fec_lean,
            fec_lean_confidence: deterministicOnly.fec_lean_confidence,
            donation_lean: deterministicOnly.donation_lean,
          },
        });
        continue;
      }

      const pipeline = await runFecDisambiguatePipeline({
        voter: row.raw_data,
        contributions,
        matchLevel: contributions.length > 0 ? matchLevel : 'none',
        historySummary: row.history_summary,
        ballotFavors: row.ballot_favors,
      });

      await persistFecEvidence();

      results.push({
        rowIndex: row.row_index,
        voterRecordId: row.id,
        name: row.raw_data.name.full,
        fec_source: fecSource,
        grok_used: pipeline.grok_used,
        grok_skip_reason: pipeline.grok_skip_reason,
        deterministic: pipeline.deterministic,
        usage: pipeline.usage,
        result: {
          identity_band: pipeline.deterministic.identity.identity_band,
          probable_same_person:
            pipeline.enrichment.identity_resolution_status === 'probable' ||
            pipeline.deterministic.identity.probable_same_person,
          identity_resolution_status: pipeline.enrichment.identity_resolution_status,
          identity_best_match_score: pipeline.enrichment.identity_best_match_score,
          identity_matches: pipeline.enrichment.identity_matches,
          lean: pipeline.lean,
          confidence: pipeline.confidence,
          lean_signals_found: pipeline.enrichment.lean_signals_found,
          evidence: pipeline.evidence,
          fec_lean: pipeline.deterministic.donation_lean?.lean ?? deterministicOnly.fec_lean,
          fec_lean_confidence:
            pipeline.deterministic.donation_lean?.confidence ??
            deterministicOnly.fec_lean_confidence,
        },
      });
    }

    const confirmed = results.filter(
      (r) => 'result' in r && r.result?.probable_same_person === true,
    ).length;
    const withLean = results.filter(
      (r) => 'result' in r && r.result?.fec_lean && r.result.fec_lean !== 'Undetermined',
    ).length;

    return NextResponse.json({
      upload_id: body.uploadId,
      mode: 'fec-disambiguate',
      row_count: rowIndices.length,
      confirmed_matches: confirmed,
      rows_with_fec_lean: withLean,
      rows: results,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'FEC disambiguate failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}