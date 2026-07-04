'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface AccountRow {
  account_id: string;
  display_name: string;
  fec_committee_id: string | null;
  contact_email: string | null;
  prepaid_balance_usd: string;
}

interface LedgerRow {
  id: string;
  upload_id: string | null;
  kind: string;
  arm: string | null;
  tier: number | null;
  amount_usd: string;
  note: string | null;
  created_at: string;
}

interface InvoiceRow {
  upload_id: string;
  filename: string | null;
  created_at: string;
  baseline_count: number;
  tier1_count: number;
  tier2_count: number;
  tier3_count: number;
  osint_attempts: number;
  charges_usd: string;
}

interface RateCard {
  scope: string;
  initiation_usd: string | null;
  baseline_usd: string | null;
  tier1_usd: string | null;
  tier2_usd: string | null;
  tier3_usd: string | null;
  osint_attempt_usd: string | null;
}

const usd = (v: string | number | null | undefined) =>
  `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FEE_FIELDS = [
  { key: 'initiation_usd', label: 'Initiation (kickoff)' },
  { key: 'baseline_usd', label: 'Baseline / record' },
  { key: 'tier1_usd', label: 'Tier 1 (FEC)' },
  { key: 'tier2_usd', label: 'Tier 2 (FL/Sunbiz)' },
  { key: 'tier3_usd', label: 'Tier 3 (OSINT)' },
  { key: 'osint_attempt_usd', label: 'OSINT / attempt' },
] as const;

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    balance: AccountRow;
    ledger: LedgerRow[];
    invoice: InvoiceRow[];
  } | null>(null);
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // create-account form
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newFec, setNewFec] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newBillInitiation, setNewBillInitiation] = useState(true);
  // deposit form
  const [depositAmt, setDepositAmt] = useState('');

  const refreshAccounts = useCallback(async () => {
    const res = await fetch('/api/accounts');
    const data = await res.json();
    if (res.ok) setAccounts(data.accounts ?? []);
    else setError(data.error ?? 'Failed to load accounts');
  }, []);

  const refreshRateCards = useCallback(async () => {
    const res = await fetch('/api/rate-cards');
    const data = await res.json();
    if (res.ok) setRateCards(data.rateCards ?? []);
  }, []);

  const loadDetail = useCallback(async (accountId: string) => {
    const res = await fetch(`/api/accounts/${accountId}`);
    const data = await res.json();
    if (res.ok) setDetail(data);
    else setError(data.error ?? 'Failed to load account');
  }, []);

  useEffect(() => {
    void refreshAccounts();
    void refreshRateCards();
  }, [refreshAccounts, refreshRateCards]);

  useEffect(() => {
    if (selected) void loadDetail(selected);
    else setDetail(null);
  }, [selected, loadDetail]);

  async function createAccount() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: newId,
          displayName: newName,
          fecCommitteeId: newFec,
          contactEmail: newEmail,
          billInitiation: newBillInitiation,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Create failed');
      setNewId('');
      setNewName('');
      setNewFec('');
      setNewEmail('');
      setNewBillInitiation(true);
      await refreshAccounts();
      setSelected(data.account.account_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function deposit() {
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/${selected}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(depositAmt) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Deposit failed');
      setDepositAmt('');
      await refreshAccounts();
      await loadDetail(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deposit failed');
    } finally {
      setBusy(false);
    }
  }

  async function chargeKickoff() {
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/${selected}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'initiation' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Initiation charge failed');
      if (!data.charged) setError('Initiation fee was already charged (or is $0) — nothing billed.');
      await refreshAccounts();
      await loadDetail(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Initiation charge failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveRateCard(scope: string, fees: Record<string, string>) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/rate-cards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, ...fees }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      await refreshRateCards();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  const defaultCard = rateCards.find((r) => r.scope === 'default');
  const overrideCard = selected ? rateCards.find((r) => r.scope === selected) : undefined;

  return (
    <main className="theme-matrix min-h-screen p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Billing console</h1>
            <p className="text-sm opacity-70">Prepaid accounts, deposits, invoices, and rates.</p>
          </div>
          <Link href="/dashboard" className="rounded-lg border px-4 py-2 text-sm hover:opacity-80">
            ← Dashboard
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {/* Left: accounts list + create */}
          <div className="space-y-4">
            <section className="panel rounded-2xl p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide opacity-70">Accounts</h2>
              <ul className="space-y-1">
                {accounts.map((a) => (
                  <li key={a.account_id}>
                    <button
                      onClick={() => setSelected(a.account_id)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:opacity-90 ${
                        selected === a.account_id
                          ? 'border-emerald-400/50 bg-emerald-500/10'
                          : 'border-white/10 bg-black/20'
                      }`}
                    >
                      <span className="truncate">
                        <span className="font-medium">{a.display_name}</span>
                        <span className="ml-1 opacity-60">{a.account_id}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{usd(a.prepaid_balance_usd)}</span>
                    </button>
                  </li>
                ))}
                {accounts.length === 0 && <li className="text-sm opacity-60">No accounts yet.</li>}
              </ul>
            </section>

            <section className="panel rounded-2xl p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide opacity-70">
                New account
              </h2>
              <div className="space-y-2">
                <input
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  placeholder="account id (slug, e.g. smith-for-senate)"
                  className="w-full rounded-lg border bg-black/20 px-3 py-2 font-mono text-sm"
                />
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="display name"
                  className="w-full rounded-lg border bg-black/20 px-3 py-2 text-sm"
                />
                <input
                  value={newFec}
                  onChange={(e) => setNewFec(e.target.value)}
                  placeholder="FEC committee id (optional)"
                  className="w-full rounded-lg border bg-black/20 px-3 py-2 font-mono text-sm"
                />
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="contact email (optional)"
                  className="w-full rounded-lg border bg-black/20 px-3 py-2 text-sm"
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newBillInitiation}
                    onChange={(e) => setNewBillInitiation(e.target.checked)}
                  />
                  <span>Bill initiation fee (rate card)</span>
                </label>
                <button
                  onClick={createAccount}
                  disabled={busy || !newId || !newName}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Create account
                </button>
              </div>
            </section>
          </div>

          {/* Right: detail */}
          <div className="space-y-4">
            {!detail && (
              <section className="panel rounded-2xl p-6 text-sm opacity-60">
                Select an account to view its balance, invoices, and ledger.
              </section>
            )}

            {detail && (
              <>
                <section className="panel rounded-2xl p-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">{detail.balance.display_name}</h2>
                      <p className="font-mono text-xs opacity-60">
                        {detail.balance.account_id}
                        {detail.balance.fec_committee_id ? ` · ${detail.balance.fec_committee_id}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold tabular-nums text-emerald-300">
                        {usd(detail.balance.prepaid_balance_usd)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide opacity-60">
                        Prepaid balance
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      value={depositAmt}
                      onChange={(e) => setDepositAmt(e.target.value)}
                      placeholder="deposit amount"
                      inputMode="decimal"
                      className="w-40 rounded-lg border bg-black/20 px-3 py-2 text-sm"
                    />
                    <button
                      onClick={deposit}
                      disabled={busy || !(Number(depositAmt) > 0)}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Record deposit
                    </button>
                    {!detail.ledger.some((l) => l.kind === 'initiation') && (
                      <button
                        onClick={chargeKickoff}
                        disabled={busy}
                        className="rounded-lg border border-amber-400/50 bg-amber-500/10 px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                      >
                        Charge initiation fee
                      </button>
                    )}
                  </div>
                </section>

                {/* Invoice per batch */}
                <section className="panel rounded-2xl p-4">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-70">
                    Invoices by batch
                  </h3>
                  {detail.invoice.length === 0 ? (
                    <p className="text-sm opacity-60">No billed batches yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="opacity-60">
                          <tr>
                            <th className="py-1 pr-3">Batch</th>
                            <th className="py-1 pr-3 text-right">Baseline</th>
                            <th className="py-1 pr-3 text-right">T1</th>
                            <th className="py-1 pr-3 text-right">T2</th>
                            <th className="py-1 pr-3 text-right">T3</th>
                            <th className="py-1 pr-3 text-right">OSINT tries</th>
                            <th className="py-1 text-right">Charged</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.invoice.map((row) => (
                            <tr key={row.upload_id} className="border-t border-white/5">
                              <td className="py-1 pr-3">{row.filename ?? row.upload_id.slice(0, 8)}</td>
                              <td className="py-1 pr-3 text-right tabular-nums">{row.baseline_count}</td>
                              <td className="py-1 pr-3 text-right tabular-nums">{row.tier1_count}</td>
                              <td className="py-1 pr-3 text-right tabular-nums">{row.tier2_count}</td>
                              <td className="py-1 pr-3 text-right tabular-nums">{row.tier3_count}</td>
                              <td className="py-1 pr-3 text-right tabular-nums">{row.osint_attempts}</td>
                              <td className="py-1 text-right tabular-nums text-amber-200">
                                {usd(row.charges_usd)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* Rate card editor */}
                <RateCardEditor
                  title="Default rate card"
                  scope="default"
                  card={defaultCard}
                  requireAll
                  busy={busy}
                  onSave={saveRateCard}
                />
                <RateCardEditor
                  title={`Override for ${detail.balance.account_id}`}
                  scope={detail.balance.account_id}
                  card={overrideCard}
                  hint="Leave a fee blank to inherit the default."
                  busy={busy}
                  onSave={saveRateCard}
                />

                {/* Ledger */}
                <section className="panel rounded-2xl p-4">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-70">
                    Ledger (latest 200)
                  </h3>
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-black/40 opacity-70">
                        <tr>
                          <th className="py-1 pr-3">When</th>
                          <th className="py-1 pr-3">Kind</th>
                          <th className="py-1 pr-3">Detail</th>
                          <th className="py-1 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.ledger.map((l) => (
                          <tr key={l.id} className="border-t border-white/5">
                            <td className="py-1 pr-3 opacity-70">
                              {new Date(l.created_at).toLocaleString()}
                            </td>
                            <td className="py-1 pr-3">{l.kind}</td>
                            <td className="py-1 pr-3 opacity-70">
                              {l.note ?? [l.arm, l.tier != null ? `tier ${l.tier}` : null].filter(Boolean).join(' · ')}
                            </td>
                            <td
                              className={`py-1 text-right tabular-nums ${
                                Number(l.amount_usd) >= 0 ? 'text-emerald-300' : 'text-amber-200'
                              }`}
                            >
                              {usd(l.amount_usd)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function RateCardEditor({
  title,
  scope,
  card,
  requireAll,
  hint,
  busy,
  onSave,
}: {
  title: string;
  scope: string;
  card: RateCard | undefined;
  requireAll?: boolean;
  hint?: string;
  busy: boolean;
  onSave: (scope: string, fees: Record<string, string>) => void;
}) {
  const [fees, setFees] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of FEE_FIELDS) next[f.key] = card?.[f.key] != null ? String(card[f.key]) : '';
    setFees(next);
  }, [card]);

  return (
    <section className="panel rounded-2xl p-4">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide opacity-70">{title}</h3>
      {hint && <p className="mb-2 text-xs opacity-60">{hint}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {FEE_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="text-[10px] uppercase tracking-wide opacity-60">{f.label}</span>
            <input
              value={fees[f.key] ?? ''}
              onChange={(e) => setFees((p) => ({ ...p, [f.key]: e.target.value }))}
              inputMode="decimal"
              placeholder={requireAll ? '' : 'inherit'}
              className="mt-1 w-full rounded-lg border bg-black/20 px-2 py-1.5 font-mono text-sm"
            />
          </label>
        ))}
      </div>
      <button
        onClick={() => onSave(scope, fees)}
        disabled={busy}
        className="mt-3 rounded-lg border border-emerald-400/50 bg-emerald-500/10 px-4 py-1.5 text-sm hover:opacity-90 disabled:opacity-50"
      >
        Save {scope === 'default' ? 'default rates' : 'override'}
      </button>
    </section>
  );
}
