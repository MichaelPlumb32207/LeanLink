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
npm run lint     # eslint CLI directly (`eslint .`) — migrated off the deprecated `next lint`
```

There is **no test runner and no typecheck script** yet (`tsc --noEmit` works ad hoc via
the tsconfig). ESLint uses flat config (`eslint.config.mjs`): `eslint-config-next` 15.x
still ships eslintrc-format configs, so they load through `FlatCompat` — don't spread the
`eslint-config-next/*` modules directly into the flat array (they aren't iterable). Apply
migrations `001` → `011` to Neon in order — either by hand
(`psql "$DATABASE_URL" -f migrations/00X_*.sql`) or, without `psql`, via
`node scripts/apply-migrations.mjs` (uses the project's `pg` driver + `.env.local`).
Migrations are additive and idempotent (`IF NOT EXISTS`; policies `DROP … IF EXISTS` then
`CREATE`) — except `007_committee_lean.sql`, whose `CREATE POLICY` predates that convention,
so a "policy already exists" error just means 007 is applied; skip it. `008` adds generic
intake + waterfall settlement columns; `009` adds prepaid billing; `010` adds FEC-retry
tracking columns; `011` adds the initiation-fee ledger kind + researcher review columns
(`review_status`/`research_status` — **the arm claim queries reference these, so 011 must be
applied before deploying code that includes them**); `012` adds the fl_extract-unbillable
posture CHECK; `013` adds the FEC federal bulk index (`fec_contributions` +
`reference_snapshots.completed_at` — Tier 1 as a local lookup; loader/runbook in
`docs/SETUP.md` §8); `014` adds `arm_runs` (per-arm run progress incl. CLI runs — the
summary's `runs` feed degrades gracefully pre-migration, but apply it anyway); `015` adds
the Sunbiz officer-name index (county-scale step ⑤ is infeasible without it); `016` adds
the partial index behind the unlabeled-committees counter (predicate tests a **non-empty**
`unresolved_committees` — events carry an empty array when none); `017` adds the Sunbiz
officer-zip index (the one the lookup's real query shape uses — DEF-007); `018` adds the
fl_contributions name-prefix index (text_pattern_ops, DEF-008); `019` adds the
**lean_patterns registry** (seeded with the exact hardcoded lists — see the patterns
gotcha below); `020` adds `'agent'` to the `committee_lean_labels.source` CHECK (the Grok
committee classifier, ENH-018). See `docs/SETUP.md`.

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

**Waterfall/review semantics** (`voter_lean_fusion`, migrations 008/011): settlement
(`settled_tier`, billed once ever) and research continuation are separate switches. Arm claim
queries share one predicate: `review_status = 'accepted'` → never claim; settled +
`research_status = 're_enrolled'` → claim anyway; otherwise claim only unsettled. The
canonical SQL lives in `CLAIM_ELIGIBLE_PREDICATE` (`lib/evidence/arm-runs.ts`), used by
`claimFecIndexRows`, `claimFreePassRows`, `countEligibleVoters`, and the ledger's
eligible-remaining count; `claimFecSweepRows` still inlines a copy — keep it in sync.
Researcher acceptance also freezes fusion — `persistFusionForVoter` early-returns for
accepted voters so their deliverable values never drift.

**Committee labels & the Grok classifier** (ENH-018): committee → lean labels
(`committee_lean_labels`, name-keyed, **federal + state share one namespace**) beat pattern
matching in BOTH the FL committee-lean path and the FEC donation-lean path (`inferContributionLean`
now consults them — that wiring was the gap). Precedence: **human > agent > pattern/party-code**.
The Grok classifier (`scripts/classify-committees.ts` → `lib/committee-lean/classify.ts`) labels
the unresolved-committee census (Grok is great at *public committees*, unlike anonymous voters) —
**bipartisan corporate PACs stay Undetermined** (never manufacture signal). `upsertAgentCommitteeLabel`
is source-aware: the agent never overwrites a human label; a human override reclaims
`source='researcher'` and locks the committee. On a billed account the agent *proposes* (default
mode, no writes); a human confirms before `--apply` settles+bills. The committee manager
(`components/committee-lean-manager.tsx`) shows every label with a source badge + confidence +
Grok reasoning and supports edit/delete (ENH-018-UI). **Applying a label only reaches a voter
after re-fusion:** manual saves and DELETE re-fuse inline (`refusionFlContribForCommittee`);
`classify --apply` re-fuses both arms (FEC re-score + `refusionAllPendingForUpload` for FL). A
labeled-but-unfused backlog surfaces as the box-score `refuse_committees` opportunity /
"Re-fuse now" (`countPendingRefusion`) — bulk re-fuse is per-voter FL re-matching (~0.5–1s each).
**"Re-fuse now" runs as a background arm_run (D-039):** the `refuse_all` route creates a
`committee_refuse` arm_run (no size cap) + fires `triggerRefuseWorker`; the worker
(`app/api/committee-lean/refuse-worker/[runId]`, `maxDuration=800`) processes the pending
committees single-pass (`listPendingRefusionCommittees` → `refusionFlContribForCommittee`),
committing + heartbeating per committee so progress shows live in the box score, self-chaining
past the budget. `arm_runs.meta.processed_committees` is written on **every** heartbeat
(`heartbeatArmRun(..., { meta })`) so a hard kill is resume-safe; budget is checked before
starting each committee; won't loop on a genuinely-conflicted committee. RunStrip treats
refuse as maintenance (voters re-fused only — no scoring-funnel vocab; bar capped at 100%).
The old 150-voter inline cap + CLI hint are gone.

**Re-pass as a product op** (ENH-010): a re-score with current logic self-cleans stale
events (`deleteVoterArmEvents`, DEF-009) and reports a before/after delta. Bracket any
re-pass with `scripts/repass-diff.ts` — `snapshot` before, `report` after (JSON baseline,
read-only). The math is pure in `lib/evidence/repass-diff.ts`
(`captureRepassSnapshot`/`diffRepassSnapshots`/`formatRepassDiffMarkdown`), reusable by a
future UI/deliverable-delta attachment; golden (m) pins it.

**Two input files, both tab-delimited FL DOS extracts, both parsed by hand (no CSV lib):**
- `lib/fl-voter-registration.ts` — the registration extract: **38 fields, no header**.
  Filtered to NPA + Active voters via `DEFAULT_LEANLINK_FILTER` at upload time.
- `lib/fl-voter-history.ts` — the optional voting-history extract (`*_H_*.txt`, 5 fields):
  summarized into turnout score / propensity / primary engagement per voter.
  The dashboard auto-routes a dropped `_H_` file to the history slot.

**Processing pipeline** (all serverless, no n8n/queue):
1. `POST /api/uploads` — parse + filter, `hashVoterPii` each row, batch-insert (100/stmt)
   into `voter_records` with any matched history summary; upload status → `ready`. **No Grok.**
   County-scale files exceed Vercel's ~4.5 MB body limit — use `scripts/ingest-extract.ts`
   (same parse/hash/insert via `lib/ingest/insert-voter-records.ts`; per-chunk commits;
   `--resume` on interruption; SETUP §9).
2. **POC enrichment** (intended path): dashboard **Analyze** → `POST /api/enrichment/test`,
   `/api/enrichment/scorecard`, `/api/enrichment/street-view`, `/api/enrichment/fec` (subset), or
   `POST /api/uploads/[id]/fec-sweep` (whole-file FEC batch, free API) — modes in
   `lib/enrichment/modes.ts`; curated rows in `lib/enrichment/suggested-test-rows.ts`.
   **Tier 3 (OSINT) at cohort scale:** `scripts/run-osint-cohort.ts` — the only paid-per-voter
   arm, so it's **hard-dollar-capped** (`--max-usd`, cap binds on `max(reported, processed×est)`,
   sequential; `--dry-run` previews with zero spend). SETUP §10; execution owner-gated.
   **OSINT is scoped to what only it can see** (ENH-016): the query plan
   (`buildPublicExpressionQueries`) and prompt target **public political expression**
   (endorsements, activism, self-ID, public follows) — it must **not** re-search FEC /
   FL campaign finance / OpenSecrets, which Tiers 1–2 resolve deterministically. Measured T3
   lean-yield is near-zero even on known donors (`osint-control-test.ts`); treat OSINT as a
   persona-linkage/enrichment arm, not a settle arm. **No brokers / no covert access** — public
   sources only (a client-facing promise); sock-puppet/authenticated FB/IG scraping is out.
   **Tier 1 primary path (D-028):** the local FEC bulk index — `match-fec-index` evidence
   action (≤5k voters) or `scripts/run-fec-index.ts` at county scale; the API sweep is the
   fallback. Requires a READY `fec_indiv` snapshot (loader: `scripts/import-fec-indiv.ts`).
   Matching spans **all** completed `fec_indiv` snapshots at once (`getActiveFecIndivSnapshotSet`
   → `lookupFecIndexForVoter(client, ids[], …)`, `snapshot_id = ANY`), so backfilling older
   cycles (indiv22/indiv20, each its own `--label`) is a pure additive hit-rate lift — SETUP §8a.
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

**Progress UI is the box score** (D-029): `components/box-score.tsx` (pinned scoreboard +
per-arm line score + live strip) renders `UploadEvidenceSummary` via the pure builder
`lib/box-score.ts`; `components/use-evidence-summary.ts` owns the **single** polling loop
(5s while a run is active, 30s idle, paused on hidden tab) at page level and passes
`summary`/`refreshSummary` down into the evidence workspace. Don't add per-panel polling
loops or render summary numbers a second time — extend the summary/builder instead.
`summary.runs` (migration 014 `arm_runs` ∪ `fec_sweep_jobs`, adapt-at-read) feeds the
current-inning strip; every runner writes start/heartbeat/finish via
`lib/evidence/arm-runs.ts` (one ACTIVE run per upload+arm; stale runs reaped at 10 min).
The line-score **STATE** badge is derived from the arm's **run lifecycle**
(`summary.runs.recent[].status`), NOT event coverage — a `completed` run reads COMPLETE even
for a hit-only arm whose event count is far below the eligible pool (DEF-010); PARTIAL means a
genuinely interrupted (cancelled/failed) run. PROCESSED shows `max(run.processed_count,
voters_touched)`. **Innings are scoring arms only (D-038):** `CORE_INNINGS =
['fec','fl_contrib','osint']`. **Sunbiz** is identity enrichment (structurally 0 leans — its
leans book under FL contributions), so it's always in `box.enrichments` (even on first-run /
`not_run` — the action surface is never activity-gated) and renders **nested** inside the FL
contributions panel (`EnrichmentSection`), not as a row. **Party (T0)** is pre-game context
(no lean), shown as a muted line. Clicking an inning row also **filters the voter list**
to that arm (`handleSelectArm` → existing `armFilters`).
**Guided workbench (ENH-019, in progress):** line-score rows are clickable and expand into
`components/arm-detail-panel.tsx` — role/explainer from the pure registry
`lib/evidence/arm-details.ts`, the arm's **game log**, and the arm's actions. Every
evidence-action POST goes through the one shared hook `components/use-evidence-actions.ts` (which
also owns `confirmLongRerun`). The panels are **pure renders** — no new fetch/poll, no summary
number sourced off anything but `buildBoxScore`/`summary`. **Scoreboard single-source discipline
(D-036):** one home per number, one term per concept — the line-score row owns the per-arm funnel
stats (the panel does NOT restate them), the top bar owns the aggregate, run displays use the
board's vocabulary (**ID hits** / **lean signals** / **raw candidates**, never
confirmed/hits/leans), and `Conflicted`/`Accepted` render on the top bar only when > 0.
**No guide rail (D-037):** a TurboTax-style guide rail was built and screen-read, then removed —
its linear spine duplicated the line score and its "NEXT UP" banner duplicated the ON BASE strip
(a D-036 violation). Navigation lives in the surfaces that already exist: **the line score is the
progress view, the ON BASE strip is the next-cheap-win prompt, the arm panels are the actions.**
The old **pipeline cards are also retired** — `components/pipeline-scoreboard.tsx`,
`lib/pipeline-status.ts`, `components/pipeline-step.tsx` deleted, steps-1–5 buttons gone (their
actions live in the arm panels). Don't re-add a linear pipeline/wizard surface. The live-API FEC
sweep is gone from the UI (D-035); freshness = reload a newer FEC bulk snapshot into Neon
(`scripts/import-fec-indiv.ts`).

## Conventions & gotchas

- **Lean patterns live in the `lean_patterns` table (migration 019) with
  `lib/lean-patterns/patterns.ts` as the single fallback source — edit BOTH or
  `scripts/smoke-golden-voters.ts` fails.** Never re-hardcode a pattern list inside a
  scanner (that fork is how DEF-005/006 happened). Load via `loadLeanPatterns` at run
  boundaries and thread through; scan functions stay pure. Scoring changes bump
  `SCORER_VERSION` (`lib/evidence/scorer-version.ts`), stamped as `payload.scorer_v`
  (missing key = v1).
- **Street-address corroboration lives in ONE place: `lib/reference-data/address-match.ts`**
  (`normalizeStreet`, `addressCorroboration`, `isAddressCorroborated`) — same fork-hazard as
  the lean patterns, so never re-implement per arm. Each arm scores identity independently but
  corroborates the street through this helper. **Sunbiz hard-gates on it** (ENH-012):
  `scoreSunbizOfficerMatch` (`lib/sunbiz/lookup.ts`) caps any match lacking a corroborated
  street below the 0.55 probable line, so name+zip collisions against the 20.6M-row officer
  corpus land at `ambiguous` and can never settle; the layer-2 bridge
  (`lib/free-pass/run-voter.ts`) bridges only address-corroborated officers. **fl_contrib**
  uses it as a soft bonus plus a recency-aware zip penalty (ENH-013). FEC has no street field
  → stays zip+city. Comparison is in-memory (address already stored/selected) — no
  index/migration. Bump `SCORER_VERSION` on changes (currently 3).
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
