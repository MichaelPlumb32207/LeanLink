import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { chargeInitiation, getBalance, recordDeposit } from '@/lib/billing/ledger';
import { resolveRates } from '@/lib/billing/rates';

/** Account detail: balance, recent ledger, and a per-batch invoice rollup. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: accountId } = await context.params;

    const data = await withUserDb(userEmail, async (client) => {
      const balance = await getBalance(client, accountId);
      if (!balance) return null;

      const ledger = await client.query(
        `SELECT id, upload_id, voter_record_id, kind, arm, tier, amount_usd, note, created_at
         FROM billing_ledger
         WHERE account_id = $1
         ORDER BY created_at DESC
         LIMIT 200`,
        [accountId],
      );

      // Per-batch invoice: baseline count, tier charges, OSINT attempts, total.
      const invoice = await client.query(
        `SELECT u.id AS upload_id, u.filename, u.created_at,
                COUNT(*) FILTER (WHERE l.kind = 'baseline')::int AS baseline_count,
                COUNT(*) FILTER (WHERE l.kind = 'charge' AND l.tier = 1)::int AS tier1_count,
                COUNT(*) FILTER (WHERE l.kind = 'charge' AND l.tier = 2)::int AS tier2_count,
                COUNT(*) FILTER (WHERE l.kind = 'charge' AND l.tier = 3)::int AS tier3_count,
                COUNT(*) FILTER (WHERE l.kind = 'attempt')::int AS osint_attempts,
                COALESCE(-SUM(l.amount_usd) FILTER (WHERE l.amount_usd < 0), 0) AS charges_usd
         FROM voter_uploads u
         JOIN billing_ledger l ON l.upload_id = u.id
         WHERE u.account_id = $1
         GROUP BY u.id, u.filename, u.created_at
         ORDER BY u.created_at DESC`,
        [accountId],
      );

      return { balance, ledger: ledger.rows, invoice: invoice.rows };
    });

    if (!data) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to load account' }, { status: 500 });
  }
}

/**
 * Record money against the account: a prepaid deposit (default), or — with
 * kind='initiation' — the one-time kickoff fee at the rate-card price (deduped;
 * charging twice is a no-op).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: accountId } = await context.params;
    const body = await request.json();

    if (body.kind === 'initiation') {
      const result = await withUserDb(userEmail, async (client) => {
        const existing = await getBalance(client, accountId);
        if (!existing) return null;
        const rates = await resolveRates(client, accountId);
        const charged =
          rates.initiation > 0 &&
          (await chargeInitiation(client, { userId: userEmail, accountId, amount: rates.initiation }));
        return { charged, balance: await getBalance(client, accountId) };
      });
      if (!result) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
      return NextResponse.json(result);
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }

    const balance = await withUserDb(userEmail, async (client) => {
      const existing = await getBalance(client, accountId);
      if (!existing) return null;
      await recordDeposit(client, {
        userId: userEmail,
        accountId,
        amount,
        note: String(body.note ?? 'prepaid deposit').slice(0, 200),
      });
      return getBalance(client, accountId);
    });

    if (!balance) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    return NextResponse.json({ balance });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to record deposit' }, { status: 500 });
  }
}
