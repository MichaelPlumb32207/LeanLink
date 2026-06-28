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
| `ENRICHMENT_MODE` | Batch mode when batch enabled: `grok-full` \| `apify-modular` \| etc. |
| `LEANLINK_ENABLE_BATCH_INFERENCE` | Leave **unset** for POC (blocks full-file jobs). Set `true` only when ready for county-scale Grok spend. |

## 2. Database

No migration runner — apply SQL files in order, by hand:

```bash
psql "$DATABASE_URL" -f migrations/001_initial_schema.sql
psql "$DATABASE_URL" -f migrations/002_history_columns.sql
```

Migrations are additive and idempotent (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT
EXISTS`), so re-running is safe. RLS is enabled by 001 — the app sets `app.current_user`
per transaction, so nothing extra is needed at the DB level.

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

Smoke test: sign in → upload a FL registration `.txt` → confirm row count → use **Test
enrichment** or **POC scorecard** on a curated row (no full-file job unless
`LEANLINK_ENABLE_BATCH_INFERENCE=true`). Export CSV when results exist.

## 5. Vercel deploy

1. Import the repo into Vercel (team Liberty Concierge). **Pro plan is required** — the
   worker route sets `maxDuration = 800` (≈13 min), which exceeds Hobby limits. On Hobby,
   workers are killed early and jobs stall in perpetual sweeper retries.
2. Set every `.env.local` var in the Vercel project (set `NEXTAUTH_URL` to the prod URL).
3. `vercel.json` registers the cron (`/api/cron/job-sweeper`, every minute). Vercel sends
   `x-vercel-cron: 1`; the route also accepts `Authorization: Bearer $CRON_SECRET`.
4. Deploy by pushing to `main` (`git push origin HEAD:main`) — Vercel auto-builds. Do **not**
   run `vercel --prod` (double build). Commit author email must be a valid GitHub account or
   Vercel blocks the deploy.

## 6. Input data

- **Registration extract** — FL DOS county voter extract, tab-delimited, 38 fields, no
  header (e.g. `CAL_20250812.txt`). Auto-filtered to NPA + Active on upload.
- **Voting-history extract** (optional, recommended) — `*_H_*.txt`, 5 fields. Powers turnout
  and primary-engagement scoring. Drop it on the dashboard; `_H_` files auto-route.

These contain PII and are **gitignored** — keep them local; never commit.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Jobs never finish / stuck `running` | Vercel plan not Pro → worker dies before `maxDuration`. |
| Queries return empty despite data | `withUserDb` not used (RLS blocks bare `pool` reads). |
| `Expected 38 tab fields, got N` | Wrong file (history file in the registration slot, or CSV). |
| Sign-in bounces back to /login | Email ≠ `ALLOWED_USER_EMAIL`, or redirect URI mismatch. |
| 401 from worker/cron | `INTERNAL_JOB_SECRET` / `CRON_SECRET` missing or mismatched. |
