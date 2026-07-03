import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { resolveRates } from '@/lib/billing/rates';

/** List the default rate card plus any per-account overrides. */
export async function GET() {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { rows } = await withUserDb(userEmail, (client) =>
      client.query(
        `SELECT scope, baseline_usd, tier1_usd, tier2_usd, tier3_usd, osint_attempt_usd, updated_at
         FROM rate_cards
         ORDER BY (scope = 'default') DESC, scope`,
      ),
    );
    return NextResponse.json({ rateCards: rows });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to list rate cards' }, { status: 500 });
  }
}

const FEE_KEYS = ['baseline_usd', 'tier1_usd', 'tier2_usd', 'tier3_usd', 'osint_attempt_usd'] as const;

/**
 * Upsert a rate-card scope. scope='default' edits the base fees; scope=<account_id>
 * sets an override (NULL fees fall back to default). No redeploy needed.
 */
export async function PUT(request: Request) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const body = await request.json();
    const scope = String(body.scope ?? '').trim();
    if (!scope) return NextResponse.json({ error: 'scope is required' }, { status: 400 });

    const fees: Record<string, number | null> = {};
    for (const key of FEE_KEYS) {
      const raw = body[key];
      if (raw === undefined || raw === null || raw === '') {
        fees[key] = null;
      } else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ error: `${key} must be a non-negative number` }, { status: 400 });
        }
        fees[key] = n;
      }
    }
    // The default card must never carry NULL fees — it's the fallback of record.
    if (scope === 'default' && FEE_KEYS.some((k) => fees[k] === null)) {
      return NextResponse.json({ error: 'default rate card requires all fees set' }, { status: 400 });
    }

    const resolved = await withUserDb(userEmail, async (client) => {
      if (scope !== 'default') {
        const acct = await client.query(`SELECT 1 FROM accounts WHERE account_id = $1`, [scope]);
        if (acct.rowCount === 0) throw new Error(`Unknown account_id for override: ${scope}`);
      }
      await client.query(
        `INSERT INTO rate_cards (scope, user_id, baseline_usd, tier1_usd, tier2_usd, tier3_usd, osint_attempt_usd, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (scope) DO UPDATE SET
           baseline_usd = EXCLUDED.baseline_usd,
           tier1_usd = EXCLUDED.tier1_usd,
           tier2_usd = EXCLUDED.tier2_usd,
           tier3_usd = EXCLUDED.tier3_usd,
           osint_attempt_usd = EXCLUDED.osint_attempt_usd,
           updated_at = NOW()`,
        [
          scope,
          userEmail,
          fees.baseline_usd,
          fees.tier1_usd,
          fees.tier2_usd,
          fees.tier3_usd,
          fees.osint_attempt_usd,
        ],
      );
      // Return the effective (merged) rates for this scope.
      return resolveRates(client, scope === 'default' ? null : scope);
    });

    return NextResponse.json({ scope, effective: resolved });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const detail = error instanceof Error ? error.message : 'Failed to save rate card';
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
