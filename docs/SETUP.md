# LeanLink — Setup & Provisioning Runbook

The authoritative guide for standing up a fresh LeanLink instance — local or production.
Written so a new owner with their own accounts can run it end to end. Assumes Node 20+ and
`psql` available.

## 0. Prerequisites / accounts you provision

| Service | Why | Notes |
|---|---|---|
| Neon Postgres | App database | Use the **pooled** connection string. |
| Google Cloud OAuth | Sign-in | OAuth consent screen + Web client. |
| xAI (Grok) | Lean inference (when wired) | API key. See `docs/CLAUDE.md` for endpoint/model. |
| Vercel | Hosting + cron | **Pro plan required** (see step 5). |

## 1. Clone, env, install

```bash
cp .env.example .env.local
npm install
```

Fill in `.env.local`:

| Var | How to get it |
|---|---|
| `DATABASE_URL` | Neon dashboard → pooled connection string (`?sslmode=require`). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Step 3. |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `http://localhost:3000` locally; your prod URL in Vercel. |
| `ALLOWED_USER_EMAIL` | The single Google account allowed to sign in. |
| `INTERNAL_JOB_SECRET` | `openssl rand -base64 32` — authorizes worker self-calls. |
| `CRON_SECRET` | `openssl rand -base64 32` — authorizes the cron sweeper. |
| `XAI_API_KEY` | xAI console — required for live enrichment tests. |
| `XAI_MODEL` | Optional; default `grok-4.3`. |
| `GOOGLE_MAPS_API_KEY` | Google Cloud — Street View Static API (enrichment tests). |
| `APIFY_API_TOKEN` | Apify console — `apify-modular` fetch layer. |
| `FEC_API_KEY` | [FEC Open API](https://api.open.fec.gov/developers/) — optional; `DEMO_KEY` works locally with strict rate limits. |
| `ENRICHMENT_MODE` | Batch mode when batch enabled: `grok-full` \| `apify-modular` \| etc. |
| `LEANLINK_ENABLE_BATCH_INFERENCE` | Leave **unset** for POC (blocks full-file jobs). Set `true` only when ready for county-scale Grok spend. |

## 2. Database

Apply the SQL files in order. If you have `psql`:

```bash
for f in migrations/0*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

**No `psql`? Use the bundled Node runner** (uses the project's `pg` driver; reads
`DATABASE_URL` from the environment or `.env.local`):

```bash
node scripts/apply-migrations.mjs                       # applies 007–011 by default
node scripts/apply-migrations.mjs migrations/011_initiation_and_review.sql   # or specific files
```

Full order:

| File | Adds |
|---|---|
| `001_initial_schema.sql` | uploads / records / jobs / lean_results + RLS |
| `002_history_columns.sql` | voting-history summary columns |
| `003_fec_sweep.sql` | FEC sweep jobs + per-voter lookup results |
| `004_fec_identity.sql` | FEC identity scoring columns |
| `005_evidence_ledger.sql` | `evidence_events` + `voter_lean_fusion` |
| `006_reference_data.sql` | FL contributions + Sunbiz officer bulk indexes |
| `007_committee_lean.sql` | researcher committee→lean labels |
| `008_generic_intake_and_settlement.sql` | generic-intake source + completeness cols; waterfall `settled_*` cols |
| `009_billing.sql` | `accounts`, `billing_ledger`, `rate_cards` (+ default seed), `voter_uploads.account_id` |
| `010_fec_retry.sql` | `fec_lookup_results.retry_attempts` + `last_attempt_at` (background retry of failed FEC lookups) |
| `011_initiation_and_review.sql` | `initiation` ledger kind + `rate_cards.initiation_usd` (seeded $2,500); `voter_lean_fusion.review_status` / `research_status` (accept-freeze / re-enroll) |
| `012_fl_extract_unbilled.sql` | posture guardrail: `CHECK` that an `fl_extract` upload never carries a billing `account_id` (D-027) |
| `013_fec_indiv_index.sql` | `fec_contributions` bulk index (FL-filtered FEC federal Schedule A) + `reference_snapshots.completed_at`; makes Tier 1 a local lookup (D-028) |

Migrations are additive and idempotent (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT
EXISTS`; policies use `DROP POLICY IF EXISTS` then `CREATE`), so re-running is safe.
**One caveat:** `007_committee_lean.sql` predates the policy-idempotency convention, so a
`CREATE POLICY ... already exists` error just means 007 is already applied — skip it and
continue with 008/009. RLS is enabled per table — the app sets `app.current_user` per
transaction, so nothing extra is needed at the DB level.

## 3. Google OAuth

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** → Web.
2. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<your-prod-domain>/api/auth/callback/google`
3. Configure the OAuth consent screen. For a single-user POC, leave it in **Testing** and
   add `ALLOWED_USER_EMAIL` as a test user (avoids verification). The app *also* rejects any
   non-allowed email in `lib/auth.ts`, so consent-screen scope is belt-and-suspenders.
4. Copy client ID/secret into `.env.local`.

## 4. Run locally

```bash
npm run dev    # http://localhost:3000  → sign in with ALLOWED_USER_EMAIL
```

Smoke test: sign in → upload a FL registration `.txt` → confirm row count → select the upload →
**Analyze**: row indices should default to the county curated set → run **FEC contributor
lookup** (no Grok cost) or **Test enrichment** / **Scorecard** (requires `XAI_API_KEY`). No
full-file job unless `LEANLINK_ENABLE_BATCH_INFERENCE=true`. Export CSV when batch results exist.

## 5. Vercel deploy

1. Import the repo into Vercel (team Liberty Concierge). **Pro plan is required** — the
   worker route sets `maxDuration = 800` (≈13 min), which exceeds Hobby limits. On Hobby,
   workers are killed early and jobs stall in perpetual sweeper retries.
2. Set every `.env.local` var in the Vercel project (set `NEXTAUTH_URL` to the prod URL).
3. `vercel.json` registers two crons: `/api/cron/job-sweeper` (every minute, stall recovery)
   and `/api/cron/fec-retry` (every 5 min — re-attempts FEC lookups that failed on a transient
   API error; recovered hits flow into the evidence ledger and settle/bill). Vercel sends
   `x-vercel-cron: 1`; both routes also accept `Authorization: Bearer $CRON_SECRET`.
4. Deploy by pushing to `main` (`git push origin HEAD:main`) — Vercel auto-builds. Do **not**
   run `vercel --prod` (double build). Commit author email must be a valid GitHub account or
   Vercel blocks the deploy.

## 6. Input data

- **Registration extract** — FL DOS county voter extract, tab-delimited, 38 fields, no
  header (e.g. `CAL_20250812.txt`). Auto-filtered to NPA + Active on upload.
- **Voting-history extract** (optional, recommended) — `*_H_*.txt`, 5 fields. Powers turnout
  and primary-engagement scoring. Drop it on the dashboard; `_H_` files auto-route.

These contain PII and are **gitignored** — keep them local; never commit.

**FL extracts are research-track only (D-027):** FL DOS registration data carries use
restrictions that exclude commercial use, so uploads from this path can never bill to a
client account — the route never attaches one, and migration 012's CHECK constraint refuses
it at the database. Paid client work uses the generic intake path in §7 (client-supplied
lists, per-client accounts).

## 7. Client-list intake + prepaid billing (generic path)

Beyond the FL DOS extract, LeanLink accepts an **arbitrary client voter list** and bills
research to a prepaid account. To try it in prod:

1. **Billing console** (`/dashboard/accounts`) → create an account (a slug "campaign id",
   e.g. `smith-for-senate`; optional FEC committee id) → **Record deposit**. The **Bill
   initiation fee** checkbox (default on) charges the one-time kickoff at the rate-card price
   ($2,500 default); uncheck for internal/test accounts. Existing accounts get a "Charge
   initiation fee" button (deduped — a second charge no-ops).
2. **Client list intake** (`/dashboard/intake`) → paste/drop a CSV (header row; any of
   `name, county, address, city, state, zip, dob, email, phone, employer, party`) → pick
   the account → **Ingest list**. Rows need a name + at least one of county/ZIP/address
   (the anchor gate); each accepted record incurs the **baseline fee**.
3. Back on the dashboard, select the new upload and run **FEC → FL/Sunbiz → OSINT**. The
   waterfall **settles** a voter once a confident lean is found and **excludes** it from
   later (pricier) arms; each settlement bills its tier fee, and each OSINT attempt bills
   the attempt fee. The scoreboard shows "Settled by tier" + "Billed $…"; the Billing
   console shows the per-batch invoice + ledger.

Fees are editable in the Billing console rate-card editor (`default` + per-account
overrides). Verify the billing engine without the UI via `npx tsx scripts/smoke-billing.ts`
(runs against your DB in a rolled-back transaction — nothing persists). Settlement
threshold is `LEANLINK_SETTLE_THRESHOLD` (default 60).

**Scoring canaries:** `npx tsx scripts/smoke-golden-voters.ts` runs known-answer synthetic
voters through identity → lean → fusion (regressions for DEF-005/006/D-030, registry-seed
parity, anomaly-band math). Run it after applying migration 019 and after ANY change to
lean patterns or scoring; `--offline` skips the DB parity check. Lean patterns live in the
`lean_patterns` table (edit via SQL; keep `lib/lean-patterns/patterns.ts` in sync or the
parity golden fails).

## 8. FEC federal bulk index (fast Tier 1)

Load a cycle of FEC individual contributions (Florida-filtered, ~4–5M rows ≈ 2 GB with
indexes) so Tier 1 runs as a local index match in minutes instead of a throttled multi-day
API sweep. Stage most-recent-cycle-first; older cycles add donation history (and hit rate).

```bash
# 1. Get the cycle's files (2023–2024 example; ~2.5 GB download)
curl -LO https://www.fec.gov/files/bulk-downloads/2024/indiv24.zip
curl -LO https://www.fec.gov/files/bulk-downloads/2024/cm24.zip
unzip indiv24.zip && unzip cm24.zip        # → itcont.txt, cm.txt

# 2. Load (~30 min; interruption-safe — re-run the same command to resume)
npx tsx scripts/import-fec-indiv.ts --file itcont.txt --committees cm.txt --label 2024-fl

# 3. Check progress any time, from any terminal (loader also prints a live line)
node scripts/fec-indiv-status.mjs

# 4. Match an upload against the index
npx tsx scripts/run-fec-index.ts --upload-id UUID --concurrency 8   # county scale (no cap)
#   …or the dashboard "Match FEC (local index)" button (uploads ≤ 5,000 voters)
#   The per-voter cost is Neon round-trip latency, so N workers ≈ N× the rate
#   (default 4, max 16). --start-after M resumes a partial pass; Ctrl-C marks
#   the run cancelled in arm_runs (visible in the dashboard's current-inning strip).
```

Lookups always use the newest **READY** snapshot (`completed_at` set) — a load in progress
is never matched against. The API sweep (dashboard FEC panel) remains as a fallback for
freshness/spot checks.

## 9. County-scale extract ingest (CLI)

The dashboard upload takes the whole file in one request, so it's capped by Vercel's
~4.5 MB body limit in production (and is one long all-or-nothing transaction even on local
dev). County files go through the CLI — same parser, filter, hash, and insert as the route
(shared `lib/ingest/insert-voter-records.ts`), committed in 2,000-row chunks with progress:

```bash
npx tsx scripts/ingest-extract.ts \
  --file "/path/to/DUV_20250812.txt" \
  --history "/path/to/DUV_H_20250812.txt"     # optional voting-history extract

# Killed mid-run? The upload stays 'pending'; continue where it stopped:
npx tsx scripts/ingest-extract.ts --file "/path/…" --resume <upload-id>
```

The upload flips to `ready` only when every row is in. Reference run: Duval —
146,599 NPA+Active rows (of 710k total) in ~102 s. FL-extract ingests never carry an
`account_id` (research track, D-027). Keep the source files outside the repo.

**Keep-awake:** every long-running CLI (`ingest-extract`, `run-fec-index`, `run-free-pass`,
`import-fec-indiv`) automatically holds off macOS **idle** sleep for its own lifetime
(`lib/cli/keep-awake.ts` spawns `caffeinate -i -w <pid>`). Closing the lid still sleeps the
machine — leave it open for overnight runs; if a run dies anyway, all of these are
chunk-committed and resume on re-run.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Jobs never finish / stuck `running` | Vercel plan not Pro → worker dies before `maxDuration`. |
| Queries return empty despite data | `withUserDb` not used (RLS blocks bare `pool` reads). |
| `Expected 38 tab fields, got N` | Wrong file (history file in the registration slot, or CSV). |
| Sign-in bounces back to /login | Email ≠ `ALLOWED_USER_EMAIL`, or redirect URI mismatch. |
| 401 from worker/cron | `INTERNAL_JOB_SECRET` / `CRON_SECRET` missing or mismatched. |
