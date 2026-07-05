import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { parseFlVoterFile, DEFAULT_LEANLINK_FILTER } from '@/lib/fl-voter-registration';
import {
  buildHistorySummaryMap,
  type BallotFavors,
  type VoterHistorySummary,
} from '@/lib/fl-voter-history';
import { hashVoterPii, hashGenericVoter } from '@/lib/hash';
import { parseGenericVoterList } from '@/lib/generic-voter-list';
import { resolveRates } from '@/lib/billing/rates';
import { chargeBaselineBulk, getBalance } from '@/lib/billing/ledger';

export const maxDuration = 120;

function parseBallotFavors(value: FormDataEntryValue | null): BallotFavors {
  return value === 'north' ? 'north' : 'south';
}

/**
 * Generic client intake — a flexible voter list (CSV/TSV/pasted/JSON) with no
 * voter ID. Accepted rows are anchor-gated and carry a completeness score.
 */
async function handleGenericUpload(
  userEmail: string,
  formData: FormData,
): Promise<NextResponse> {
  const file = formData.get('file');
  const pasted = formData.get('content');
  const filename =
    file instanceof File ? file.name : (formData.get('filename') as string) || 'pasted-list';

  let content: string | null = null;
  if (file instanceof File) content = await file.text();
  else if (typeof pasted === 'string' && pasted.trim()) content = pasted;

  if (!content) {
    return NextResponse.json({ error: 'No list content provided' }, { status: 400 });
  }

  const accountId = ((formData.get('accountId') as string) || '').trim() || null;

  const parsed = parseGenericVoterList(content);
  if (parsed.accepted.length === 0) {
    return NextResponse.json(
      {
        error: 'No records passed the identity-anchor gate (need name + county/ZIP/address).',
        rejected: parsed.rejected.length,
        sampleReasons: parsed.rejected.slice(0, 3).map((r) => r.rejectReason),
      },
      { status: 400 },
    );
  }

  const result = await withUserDb(userEmail, async (client) => {
    // If billing to an account, resolve rates and pre-check the prepaid balance
    // covers at least the baseline for every accepted record.
    let rates = null as Awaited<ReturnType<typeof resolveRates>> | null;
    if (accountId) {
      const balance = await getBalance(client, accountId);
      if (!balance) throw new Error(`Unknown account_id: ${accountId}`);
      rates = await resolveRates(client, accountId);
      const baselineTotal = rates.baseline * parsed.accepted.length;
      if (balance.prepaid_balance_usd < baselineTotal) {
        throw new Error(
          `Insufficient prepaid balance: need $${baselineTotal.toFixed(2)} baseline for ` +
            `${parsed.accepted.length} records, balance is $${balance.prepaid_balance_usd.toFixed(2)}.`,
        );
      }
    }

    const uploadRes = await client.query<{ id: string }>(
      `INSERT INTO voter_uploads (user_id, filename, row_count, status, source_type, account_id)
       VALUES ($1, $2, $3, 'ready', 'generic', $4)
       RETURNING id`,
      [userEmail, filename, parsed.accepted.length, accountId],
    );
    const uploadId = uploadRes.rows[0].id;
    const batchSize = 100;
    const rows = parsed.accepted;
    const insertedIds: string[] = [];

    for (let start = 0; start < rows.length; start += batchSize) {
      const chunk = rows.slice(start, start + batchSize);
      const values: unknown[] = [];
      const placeholders = chunk.map((row, offset) => {
        const record = row.record!;
        const completeness = row.completeness!;
        const voterHash = hashGenericVoter({
          name: record.name.full,
          address: record.residence.full,
          dob: record.birthDate,
          county: record.countyCode,
        });
        const base = values.length;
        values.push(
          uploadId,
          userEmail,
          start + offset,
          // Persist the client's original columns alongside the normalized record
          // so the deliverable can echo their exact file with our columns appended.
          JSON.stringify({ ...record, _source: row.sourceColumns }),
          voterHash,
          completeness.score,
          completeness.band,
          JSON.stringify(completeness),
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, 'pending')`;
      });

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO voter_records
           (upload_id, user_id, row_index, raw_data, voter_hash,
            completeness_score, completeness_band, completeness, status)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (upload_id, voter_hash) DO NOTHING
         RETURNING id`,
        values,
      );
      insertedIds.push(...inserted.rows.map((r) => r.id));
    }

    // Baseline fee: one $0.03 (default) charge per accepted record, regardless of
    // any later lean outcome. Skipped entirely for unbilled internal/test batches.
    let baselineCharged = 0;
    if (accountId && rates) {
      baselineCharged = await chargeBaselineBulk(client, {
        userId: userEmail,
        accountId,
        uploadId,
        voterRecordIds: insertedIds,
        amount: rates.baseline,
      });
    }

    return {
      uploadId,
      sourceType: 'generic' as const,
      accountId,
      rowCount: insertedIds.length,
      rejected: parsed.rejected.length,
      baselineCharged,
      baselineCostUsd: rates ? Number((rates.baseline * baselineCharged).toFixed(4)) : 0,
      bandCounts: rows.reduce<Record<string, number>>((acc, r) => {
        const b = r.completeness!.band;
        acc[b] = (acc[b] ?? 0) + 1;
        return acc;
      }, {}),
    };
  });

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const formData = await request.formData();

    if (formData.get('sourceType') === 'generic') {
      return await handleGenericUpload(userEmail, formData);
    }

    const file = formData.get('file');
    const historyFile = formData.get('historyFile');
    const ballotFavors = parseBallotFavors(formData.get('ballotFavors'));

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

    let historyMap = new Map<string, VoterHistorySummary>();
    let historyFilename: string | null = null;

    if (historyFile instanceof File && historyFile.size > 0) {
      historyFilename = historyFile.name;
      historyMap = buildHistorySummaryMap(await historyFile.text());
    }

    const result = await withUserDb(userEmail, async (client) => {
      // Deliberately NO account_id on this path: FL DOS registration extracts are
      // research-track only (use-restricted data — see D-027) and must never bill
      // to a client account. Enforced by the voter_uploads_fl_extract_unbilled
      // CHECK (migration 012); client work goes through generic intake above.
      const uploadRes = await client.query<{ id: string }>(
        `INSERT INTO voter_uploads (user_id, filename, row_count, status, history_filename, ballot_favors)
         VALUES ($1, $2, $3, 'ready', $4, $5)
         RETURNING id`,
        [userEmail, file.name, records.length, historyFilename, ballotFavors],
      );
      const uploadId = uploadRes.rows[0].id;
      const batchSize = 100;
      let withHistory = 0;

      for (let start = 0; start < records.length; start += batchSize) {
        const chunk = records.slice(start, start + batchSize);
        const values: unknown[] = [];
        const placeholders = chunk.map((record, offset) => {
          const i = start + offset;
          const voterHash = hashVoterPii({
            voterId: record.voterId,
            name: record.name.full,
            address: record.residence.full,
          });
          const historySummary = historyMap.get(record.voterId) ?? null;
          if (historySummary && historySummary.total_events > 0) withHistory += 1;

          const base = values.length;
          values.push(
            uploadId,
            userEmail,
            i,
            JSON.stringify(record),
            voterHash,
            historySummary ? JSON.stringify(historySummary) : null,
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, 'pending')`;
        });

        await client.query(
          `INSERT INTO voter_records
             (upload_id, user_id, row_index, raw_data, voter_hash, history_summary, status)
           VALUES ${placeholders.join(', ')}`,
          values,
        );
      }

      return {
        uploadId,
        rowCount: records.length,
        historyAttached: !!historyFilename,
        votersWithHistory: withHistory,
        ballotFavors,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Upload failed', error);
    const detail = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;

    const { rows } = await withUserDb(userEmail, (client) =>
      client.query(
        `SELECT u.id,
                u.filename,
                u.row_count,
                u.status,
                u.history_filename,
                u.ballot_favors,
                u.created_at,
                j.id AS job_id,
                j.status AS job_status,
                j.processed_count,
                j.failed_count,
                j.total_count AS job_total_count,
                s.settled_count,
                s.accepted_count,
                s.conflicted_count
         FROM voter_uploads u
         LEFT JOIN LATERAL (
           SELECT id, status, processed_count, failed_count, total_count
           FROM processing_jobs
           WHERE upload_id = u.id AND user_id = $1
           ORDER BY created_at DESC
           LIMIT 1
         ) j ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE settled_tier IS NOT NULL)::int AS settled_count,
                  COUNT(*) FILTER (WHERE review_status = 'accepted')::int AS accepted_count,
                  COUNT(*) FILTER (WHERE fusion_status = 'conflicted')::int AS conflicted_count
           FROM voter_lean_fusion f
           WHERE f.upload_id = u.id AND f.user_id = $1
         ) s ON true
         WHERE u.user_id = $1
         ORDER BY u.created_at DESC
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