# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LeanLink is a single-user research proof-of-concept that ingests Florida public voter
records, infers a political "lean" + turnout/mobilization scores per voter, and exposes
results in a dashboard with CSV/JSON export. Built for a University of Florida
political-science professor — research/validation use, **not** outreach or targeting.
See `docs/CLAUDE.md` for the use posture and AI-vendor verification table, and
`docs/DECISIONS.md` for why the stack looks the way it does.

## Commands

```bash
npm run dev      # local dev (Next.js + Turbopack) on :3000
npm run build    # production build — run before any push to main (Vercel auto-deploys main)
npm run lint     # eslint (next lint)
```

There is **no test runner and no typecheck script** yet (`tsc --noEmit` works ad hoc via
the tsconfig). There is **no migration runner**: apply `migrations/001_initial_schema.sql`
then `migrations/002_history_columns.sql` to Neon by hand (`psql "$DATABASE_URL" -f ...`),
in order. Migrations are additive and idempotent (`IF NOT EXISTS`). See `docs/SETUP.md`.

## Architecture (the parts that span files)

**Single-user by construction.** Auth is NextAuth Google, hard-restricted in
`lib/auth.ts` to `ALLOWED_USER_EMAIL` (sign-in callback returns false for anyone else).
`requireUser()` gates every API route; `middleware.ts` gates the dashboard/API matcher.
There is no multi-tenant concept — `user_id` is the email string everywhere.

**Every DB access goes through `withUserDb` (`lib/db.ts`).** It opens a transaction,
runs `SELECT set_config('app.current_user', <email>, true)`, then your callback, then
commits. Postgres **RLS** policies on all four tables filter on
`current_setting('app.current_user')`, so the `set_config` is not optional decoration —
skip it and queries return nothing. Use `withUserDb`/`queryAsUser`, never `pool` directly,
except in the cron sweeper (which runs as a system job, not a user).

**Data model** (`migrations/`): `voter_uploads` 1→N `voter_records` 1→1 `lean_results`,
with `processing_jobs` tracking a run per upload. Dedup is enforced by
`UNIQUE (upload_id, voter_hash)` and `UNIQUE (user_id, voter_hash)` — the same voter
hashed twice (across uploads) will conflict on insert into `lean_results`.

**Two input files, both tab-delimited FL DOS extracts, both parsed by hand (no CSV lib):**
- `lib/fl-voter-registration.ts` — the registration extract: **38 fields, no header**.
  Filtered to NPA + Active voters via `DEFAULT_LEANLINK_FILTER` at upload time.
- `lib/fl-voter-history.ts` — the optional voting-history extract (`*_H_*.txt`, 5 fields):
  summarized into turnout score / propensity / primary engagement per voter.
  The dashboard auto-routes a dropped `_H_` file to the history slot.

**Processing pipeline** (all serverless, no n8n/queue):
1. `POST /api/uploads` — parse + filter, `hashVoterPii` each row, batch-insert (100/stmt)
   into `voter_records` with any matched history summary; upload status → `ready`. **No Grok.**
2. **POC enrichment** (intended path): `POST /api/enrichment/test`, `/api/enrichment/scorecard`,
   `/api/enrichment/street-view` — per-voter or curated ~7 rows; modes in `lib/enrichment/modes.ts`.
3. `POST /api/uploads/[id]/run` — batch job start — **gated** by `LEANLINK_ENABLE_BATCH_INFERENCE`
   (`lib/batch-inference.ts`, default off). When enabled: creates `processing_jobs`, `triggerWorker`.
4. `POST /api/jobs/[id]/worker` — batch engine (also gated). Claims rows, runs `inferLean`,
   writes `lean_results`. Self-chains before `maxDuration` budget.
5. `GET /api/cron/job-sweeper` — stall recovery; skips re-trigger when batch disabled.

**Inference** (`lib/inference.ts`, `inferLean`): when `XAI_API_KEY` is set, calls
`grokEnrichAndInferRecord` (mode from `ENRICHMENT_MODE` or `apify-modular` path). Turnout and
**opposition-mobilization scoring is real math** (`computeOppositionMobilizationScore`).
Mock fallback only when key missing or Grok errors. Guardrails in `applyInferenceGuardrails`
require ideological content in `identity_matches[].signals[]`. See `docs/CLAUDE.md` for xAI
endpoints; `docs/PROGRESS.md` for continuity.

**Results querying scales by size** (`lib/results-query.ts`, shared client+server):
small uploads sort/filter entirely in the browser; above the thresholds
(`shouldUseServerSort` / `shouldUseServerQuery`) the dashboard re-fetches with server-side
SQL built by `buildResultsSql`. When editing sort/filter behavior, both paths must stay in
sync — the column set (`SortColumn`) is the contract.

## Conventions & gotchas

- **Never `trim()` a full voter line.** `normalizeLine` only strips `\r`/`\n` — `trim()`
  would drop trailing empty tab columns and break field alignment (the file's last column,
  email/history-code, is often empty).
- **PII never goes to git.** `.gitignore` blocks `CAL_*.txt`, `*_H_*.txt`, `samples/*.txt`,
  `.env.local`. Real voter extracts and `.env.local` stay local only.
- **`@/*` path alias** maps to repo root (`tsconfig.json`).
- **Secrets**: `INTERNAL_JOB_SECRET` (worker auth), `CRON_SECRET` (sweeper auth),
  `NEXTAUTH_SECRET`, Google OAuth, `DATABASE_URL` (Neon pooled). All in `.env.example`.
- **Vercel Pro is required** — the worker's `maxDuration = 800` exceeds Hobby limits;
  on the wrong plan, workers die early and jobs silently stall (the sweeper masks it as
  perpetual retries).

## Deploy

`git push origin HEAD:main` only — Vercel auto-deploys `main` (team Liberty Concierge, Pro).
Run `npm run build` locally first; do not run `vercel --prod` (double-builds). Commits must
be authored `Michael Plumb <meplumb@gmail.com>` or Vercel blocks the deploy.
