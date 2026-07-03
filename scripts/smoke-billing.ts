/**
 * Billing smoke test — drives the real billing libs against Neon inside ONE
 * transaction that is ROLLED BACK at the end, so nothing is persisted. It proves
 * the migrations, rate resolution, per-voter dedup indexes, and balance math.
 *
 * Run from the repo root (reads DATABASE_URL from env or .env.local):
 *   npx tsx scripts/smoke-billing.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { resolveRates, tierRate } from '@/lib/billing/rates';
import {
  recordDeposit,
  getBalance,
  chargeBaselineBulk,
  chargeSettlement,
  chargeOsintAttempt,
} from '@/lib/billing/ledger';

const OPERATOR = process.env.ALLOWED_USER_EMAIL || 'meplumb@gmail.com';
const ACCOUNT = 'smoke-test-co';

function loadDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  } catch {
    /* no .env.local */
  }
  return null;
}

function ok(cond: boolean, label: string) {
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const connectionString = loadDatabaseUrl();
  if (!connectionString) throw new Error('DATABASE_URL not found in env or .env.local');
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [OPERATOR]);

    // Rate card resolves (default seeded by migration 009).
    const rates = await resolveRates(client, null);
    console.log('default rates:', rates);
    ok(rates.baseline === 0.03, 'baseline default = 0.03');

    // Per-account override merges over default.
    await client.query(
      `INSERT INTO accounts (account_id, user_id, display_name) VALUES ($1, $2, 'Smoke Test Co')`,
      [ACCOUNT, OPERATOR],
    );
    await client.query(
      `INSERT INTO rate_cards (scope, user_id, tier1_usd) VALUES ($1, $2, 0.10)`,
      [ACCOUNT, OPERATOR],
    );
    const overridden = await resolveRates(client, ACCOUNT);
    ok(
      overridden.tier1 === 0.1 && overridden.baseline === 0.03,
      'override tier1=0.10, baseline falls back to 0.03',
    );

    // Deposit.
    await recordDeposit(client, { userId: OPERATOR, accountId: ACCOUNT, amount: 10 });
    let bal = await getBalance(client, ACCOUNT);
    ok(bal?.prepaid_balance_usd === 10, `deposit $10 → balance ${bal?.prepaid_balance_usd}`);

    // Fake upload + 3 voter_records.
    const up = await client.query<{ id: string }>(
      `INSERT INTO voter_uploads (user_id, filename, row_count, status, source_type, account_id)
       VALUES ($1, 'smoke.csv', 3, 'ready', 'generic', $2) RETURNING id`,
      [OPERATOR, ACCOUNT],
    );
    const uploadId = up.rows[0].id;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO voter_records (upload_id, user_id, row_index, raw_data, voter_hash, status)
         VALUES ($1, $2, $3, '{}'::jsonb, $4, 'pending') RETURNING id`,
        [uploadId, OPERATOR, i, `smoke-${i}`],
      );
      ids.push(r.rows[0].id);
    }

    // Baseline for 3 records.
    const charged = await chargeBaselineBulk(client, {
      userId: OPERATOR,
      accountId: ACCOUNT,
      uploadId,
      voterRecordIds: ids,
      amount: overridden.baseline,
    });
    ok(charged === 3, `baseline charged for 3 records (got ${charged})`);
    // Idempotency: re-charging the same records charges nothing.
    const again = await chargeBaselineBulk(client, {
      userId: OPERATOR,
      accountId: ACCOUNT,
      uploadId,
      voterRecordIds: ids,
      amount: overridden.baseline,
    });
    ok(again === 0, 'baseline re-charge is idempotent (0 new)');

    // Settlement tier-1 on voter 0, at the account's overridden tier1 rate.
    const s1 = await chargeSettlement(client, {
      userId: OPERATOR,
      accountId: ACCOUNT,
      uploadId,
      voterRecordId: ids[0],
      arm: 'fec',
      tier: 1,
      amount: tierRate(overridden, 1),
    });
    ok(s1 === true, 'settlement tier-1 charged once');
    const s1dup = await chargeSettlement(client, {
      userId: OPERATOR,
      accountId: ACCOUNT,
      uploadId,
      voterRecordId: ids[0],
      arm: 'fec',
      tier: 1,
      amount: tierRate(overridden, 1),
    });
    ok(s1dup === false, 'settlement is idempotent per voter (0 new)');

    // OSINT attempt on voter 1 (not deduped).
    await chargeOsintAttempt(client, {
      userId: OPERATOR,
      accountId: ACCOUNT,
      uploadId,
      voterRecordId: ids[1],
      amount: overridden.osintAttempt,
    });

    // Expected balance: 10 − (3×0.03 baseline) − (0.10 tier1) − (0.05 osint) = 9.76
    bal = await getBalance(client, ACCOUNT);
    const expected = Number((10 - 3 * 0.03 - 0.1 - 0.05).toFixed(4));
    ok(bal?.prepaid_balance_usd === expected, `balance ${bal?.prepaid_balance_usd} == expected ${expected}`);

    // Invoice rollup for the batch.
    const inv = await client.query(
      `SELECT COUNT(*) FILTER (WHERE kind='baseline')::int AS baseline,
              COUNT(*) FILTER (WHERE kind='charge' AND tier=1)::int AS tier1,
              COUNT(*) FILTER (WHERE kind='attempt')::int AS attempts,
              COALESCE(-SUM(amount_usd),0) AS charges
       FROM billing_ledger WHERE upload_id = $1`,
      [uploadId],
    );
    console.log('invoice rollup:', inv.rows[0]);
    ok(
      inv.rows[0].baseline === 3 && inv.rows[0].tier1 === 1 && inv.rows[0].attempts === 1,
      'invoice counts correct',
    );

    await client.query('ROLLBACK');
    console.log('\nRolled back — nothing persisted. Billing engine verified.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('SMOKE TEST ERROR:', e);
  process.exit(1);
});
