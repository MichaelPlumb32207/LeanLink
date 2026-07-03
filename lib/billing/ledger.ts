/**
 * Billing ledger — the money log for prepaid accounts.
 *
 * Every deduction is an append-only signed row; the account's cached balance is
 * decremented in lockstep. Charge helpers are idempotent where the domain
 * demands it: one baseline and one settlement charge per voter, ever (enforced
 * by partial unique indexes), so re-runs never double-bill. OSINT attempts are
 * intentionally NOT deduped — each paid attempt is a real cost.
 */
import type { PoolClient } from 'pg';

export interface AccountBalance {
  account_id: string;
  display_name: string;
  fec_committee_id: string | null;
  prepaid_balance_usd: number;
}

/** account_id a batch bills to, or null for internal/test (unbilled) batches. */
export async function getUploadAccountId(
  client: PoolClient,
  uploadId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ account_id: string | null }>(
    `SELECT account_id FROM voter_uploads WHERE id = $1`,
    [uploadId],
  );
  return rows[0]?.account_id ?? null;
}

export async function getBalance(
  client: PoolClient,
  accountId: string,
): Promise<AccountBalance | null> {
  const { rows } = await client.query<{
    account_id: string;
    display_name: string;
    fec_committee_id: string | null;
    prepaid_balance_usd: string;
  }>(
    `SELECT account_id, display_name, fec_committee_id, prepaid_balance_usd
     FROM accounts WHERE account_id = $1`,
    [accountId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    account_id: r.account_id,
    display_name: r.display_name,
    fec_committee_id: r.fec_committee_id,
    prepaid_balance_usd: Number(r.prepaid_balance_usd),
  };
}

/** Add funds. Positive amount, kind='deposit'. */
export async function recordDeposit(
  client: PoolClient,
  args: { userId: string; accountId: string; amount: number; note?: string },
): Promise<void> {
  await client.query(
    `INSERT INTO billing_ledger (account_id, user_id, kind, amount_usd, note)
     VALUES ($1, $2, 'deposit', $3, $4)`,
    [args.accountId, args.userId, args.amount, args.note ?? null],
  );
  await client.query(
    `UPDATE accounts SET prepaid_balance_usd = prepaid_balance_usd + $2, updated_at = NOW()
     WHERE account_id = $1`,
    [args.accountId, args.amount],
  );
}

interface ChargeArgs {
  userId: string;
  accountId: string;
  uploadId: string;
  voterRecordId: string;
  amount: number;
  arm?: string;
  tier?: number;
  note?: string;
}

/**
 * Insert a charge (negative) and decrement the balance, but ONLY if a matching
 * dedupe row does not already exist (for baseline/settlement). Returns true when
 * a charge was actually written.
 */
async function insertChargeOnce(
  client: PoolClient,
  kind: 'baseline' | 'charge',
  args: ChargeArgs,
): Promise<boolean> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO billing_ledger
       (account_id, user_id, upload_id, voter_record_id, kind, arm, tier, amount_usd, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      args.accountId,
      args.userId,
      args.uploadId,
      args.voterRecordId,
      kind,
      args.arm ?? null,
      args.tier ?? null,
      -Math.abs(args.amount),
      args.note ?? null,
    ],
  );
  if (rows.length === 0) return false;
  await client.query(
    `UPDATE accounts SET prepaid_balance_usd = prepaid_balance_usd - $2, updated_at = NOW()
     WHERE account_id = $1`,
    [args.accountId, Math.abs(args.amount)],
  );
  return true;
}

/** Baseline fee for one accepted record. Once per voter (partial unique index). */
export function chargeBaseline(client: PoolClient, args: ChargeArgs): Promise<boolean> {
  return insertChargeOnce(client, 'baseline', { ...args, note: args.note ?? 'baseline processing' });
}

/**
 * Baseline fee for many records in one statement. Dedupes per voter, decrements
 * the balance by (rows actually inserted × amount). Returns the count charged.
 */
export async function chargeBaselineBulk(
  client: PoolClient,
  args: { userId: string; accountId: string; uploadId: string; voterRecordIds: string[]; amount: number },
): Promise<number> {
  if (args.voterRecordIds.length === 0) return 0;
  const values: unknown[] = [args.accountId, args.userId, args.uploadId, -Math.abs(args.amount)];
  const tuples = args.voterRecordIds.map((id, i) => {
    values.push(id);
    return `($1, $2, $3, $${i + 5}, 'baseline', $4, 'baseline processing')`;
  });
  const { rowCount } = await client.query(
    `INSERT INTO billing_ledger
       (account_id, user_id, upload_id, voter_record_id, kind, amount_usd, note)
     VALUES ${tuples.join(', ')}
     ON CONFLICT DO NOTHING`,
    values,
  );
  const charged = rowCount ?? 0;
  if (charged > 0) {
    await client.query(
      `UPDATE accounts SET prepaid_balance_usd = prepaid_balance_usd - $2, updated_at = NOW()
       WHERE account_id = $1`,
      [args.accountId, Math.abs(args.amount) * charged],
    );
  }
  return charged;
}

/** Tier success fee when a voter settles. Once per voter (partial unique index). */
export function chargeSettlement(client: PoolClient, args: ChargeArgs): Promise<boolean> {
  return insertChargeOnce(client, 'charge', args);
}

/** OSINT per-attempt fee — charged on every attempt (hit or miss), not deduped. */
export async function chargeOsintAttempt(client: PoolClient, args: ChargeArgs): Promise<void> {
  await client.query(
    `INSERT INTO billing_ledger
       (account_id, user_id, upload_id, voter_record_id, kind, arm, amount_usd, note)
     VALUES ($1, $2, $3, $4, 'attempt', $5, $6, $7)`,
    [
      args.accountId,
      args.userId,
      args.uploadId,
      args.voterRecordId,
      args.arm ?? 'osint',
      -Math.abs(args.amount),
      args.note ?? 'osint attempt',
    ],
  );
  await client.query(
    `UPDATE accounts SET prepaid_balance_usd = prepaid_balance_usd - $2, updated_at = NOW()
     WHERE account_id = $1`,
    [args.accountId, Math.abs(args.amount)],
  );
}
