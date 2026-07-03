import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';

/** List client accounts with their prepaid balances. */
export async function GET() {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { rows } = await withUserDb(userEmail, (client) =>
      client.query(
        `SELECT account_id, display_name, fec_committee_id, contact_email,
                prepaid_balance_usd, created_at
         FROM accounts
         ORDER BY created_at DESC`,
      ),
    );
    return NextResponse.json({ accounts: rows });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to list accounts' }, { status: 500 });
  }
}

/** Create a client account. account_id is a caller-supplied slug ("campaign id"). */
export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const body = await request.json();
    const accountId = String(body.accountId ?? '').trim().toLowerCase();
    const displayName = String(body.displayName ?? '').trim();

    if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(accountId)) {
      return NextResponse.json(
        { error: 'account_id must be 2–49 chars: lowercase letters, digits, hyphens.' },
        { status: 400 },
      );
    }
    if (!displayName) {
      return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
    }

    const result = await withUserDb(userEmail, async (client) => {
      const res = await client.query(
        `INSERT INTO accounts (account_id, user_id, display_name, fec_committee_id, contact_email)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id) DO NOTHING
         RETURNING account_id, display_name, fec_committee_id, contact_email, prepaid_balance_usd`,
        [
          accountId,
          userEmail,
          displayName,
          (String(body.fecCommitteeId ?? '').trim() || null),
          (String(body.contactEmail ?? '').trim() || null),
        ],
      );
      return res.rows[0] ?? null;
    });

    if (!result) {
      return NextResponse.json({ error: `account_id "${accountId}" already exists` }, { status: 409 });
    }
    return NextResponse.json({ account: result });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const detail = error instanceof Error ? error.message : 'Failed to create account';
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
