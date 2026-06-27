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
   into `voter_records` with any matched history summary; upload status → `ready`.
2. `POST /api/uploads/[id]/run` — create a `processing_jobs` row, then `triggerWorker`.
3. `POST /api/jobs/[id]/worker` — the engine. Authorized by `INTERNAL_JOB_SECRET`.
   Claims pending rows with `FOR UPDATE SKIP LOCKED`, runs `inferLean`, writes
   `lean_results`, updates counts/heartbeat. When time budget nears
   (`getWorkerDeadlineMs`, 80% of `maxDuration`=800s) it **re-triggers itself** for the
   next batch — this is how it processes more rows than one function invocation allows.
4. `GET /api/cron/job-sweeper` (Vercel cron, every minute, `vercel.json`) — resets rows
   stuck in `processing` >15min and re-triggers jobs with a stale heartbeat. Self-healing
   for crashed/timed-out workers.

**Inference is still a mock** (`lib/inference.ts`, `inferLean`). The turnout and
**opposition-mobilization scoring is real math** (`computeOppositionMobilizationScore`,
gated on the upload's `ballot_favors` north/south scenario), but the **lean direction and
confidence are deterministic stubs** keyed on `voterId` (`mock-v2`, audit
`model_version: history-aware-mock-v2`). Wiring the real Grok/xAI call here is the next
major task — see `docs/CLAUDE.md` for the verified endpoint/model. NOTE: the older
`mockInferLean` in `lib/job-runner.ts` is now dead code, superseded by `inferLean`.

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
