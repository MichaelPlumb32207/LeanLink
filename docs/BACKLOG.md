# LeanLink — Backlog (defects · enhancements · features)

The work-item ledger: every defect gets a `DEF-` entry **when it's found**, updated when
it's fixed — root cause included, so lessons aren't re-learned. Discrete enhancements and
features get `ENH-`/`FEAT-` entries. Horizons and priorities live in
[`ROADMAP.md`](ROADMAP.md) (this file is the ledger, not the plan); design rationale lives
in [`DECISIONS.md`](DECISIONS.md); every fixed defect should also add a regression test
row in [`USE_CASES.md`](USE_CASES.md) — the "Regression" column links it.

Status: 🔴 open · 🟡 in progress · ✅ fixed/shipped · ⬜ won't fix (say why)

## Defects

| ID | Status | Pri | Title | Root cause → fix | Regression |
|---|---|---|---|---|---|
| DEF-006 | ✅ 2026-07-06 | P1 | Same `\b\(` bug in `lib/committee-lean/infer.ts` — Tier 2 (FL contrib) could never read "(REP)"/"(DEM)"/"(PTY)" committee names | Discovered via the Duval Tier 2 first pass: 465 hit voters, **0 settles**, with "DeSantis, Ron (REP)(GOV)" / "Crist, Charlie (DEM)(GOV)" sitting in the *unresolved* pile (521 distinct committees). Same root cause as DEF-005 in a second module; codebase swept — no further instances. Fix: drop the `\b`; Duval fl-contrib re-passed. Lesson: patterns duplicated across modules should share one source (see donation-lean vs committee-lean). | T13.x via re-pass; unresolved census in PROGRESS |
| DEF-005 | ✅ 2026-07-06 | P1 | Party-code patterns `\b\(rep\)`/`\b\(dem\)` never matched — confirmed donor to "TRISHA 4 COLORADO (DEM)" stayed Undetermined | `\b` before `\(` requires a word char adjacent; both the space and paren are non-word, so the regex was unmatchable since the FL patterns were written. D-030 fixed the *data* (party reaches the name); this fixes the *pattern*. Found by owner on Duval row 1619. Fix: drop the `\b`. Duval re-passed post-fix. | T11.9 (now actually exercised) |
| DEF-004 | ✅ 2026-07-05 | P1 | Confirmed FEC donor shows no recipients; lean "party unclear" despite known committee party | Two-fold (D-030): `lookupFecIndexForVoter` dropped the committee master's party code before lean scoring (regex-only lean); confirmed-no-lean events wrote zero recipient lines. Fix `4215c27`: party folded into committee display name so `\(rep\)`/`\(dem\)` patterns fire on authoritative data; both FEC builders itemize receipts + `payload.receipts`. Found by owner on Duval row 113. | T11.9–T11.10 |
| DEF-003 | ✅ 2026-07-05 | P1 | County-scale upload silently fails — no error trail, nothing in DB | Vercel caps request bodies at ~4.5 MB; the dashboard sends the whole file in one request, and the single-transaction ingest rolls back completely on any failure (Duval, 115 MB, never reached our code). Fix `ccb1cdb`: `scripts/ingest-extract.ts` (chunk-committed, resumable, shared insert helper); SETUP §9. | T2.4–T2.6 |
| DEF-002 | ✅ 2026-07-05 | P2 | Mac sleep pauses county-scale CLI runs mid-flight | Long runs (hours) outlive the display-sleep timer; nothing held a power assertion. Fix `e9b9a15`: `lib/cli/keep-awake.ts` (`caffeinate -i -w <pid>`) wired into all four long CLIs. Limit: lid-close still sleeps — chunked commits + resume are the backstop. | SETUP §9 note |
| DEF-001 | ✅ 2026-07-04 | P2 | Lint gate was dead — `next lint` deprecated, findings accumulated unseen | `next lint` removal in Next 15 left the script a no-op. Fix `344982b`: ESLint CLI + flat config via `FlatCompat` (the `eslint-config-next` modules aren't iterable — don't spread them directly; see root CLAUDE.md). | `npm run lint` in pre-push gate |

## Enhancements

| ID | Status | Pri | Title | Notes |
|---|---|---|---|---|
| ENH-004 | ✅ 2026-07-05 | P1 | Concurrent FEC index match (`--concurrency N`) | The per-voter cost is Neon RTT from the operator Mac, not Postgres work — N workers overlap the waits. Measured on Duval: 2.6/s → **22–23/s at 8 workers** (~8.5×; 15.5 h → ~1.6 h). Workers commit per ~10 voters; voter-scoped writes never contend. Ctrl-C now marks the run `cancelled` in arm_runs. Next lever if ever needed: run adjacent to Neon (us-east-1) for another ~10–30×. |
| ENH-003 | ✅ 2026-07-06 | P1 | Box score Phase B — `arm_runs` live progress (migration 014) | Migration 014 (applied), `lib/evidence/arm-runs.ts` (start/heartbeat/finish, 10-min stale reap, one active run per upload+arm), `summary.runs` (arm_runs ∪ fec_sweep_jobs at read), current-inning strip (progress/rate/ETA/heartbeat/CLI chip/stalled), uploads-list live dot. **Free-pass hardening (2026-07-06):** `loadFreePassContext` hoisted (household index loads once), `claimFreePassRows` on the shared predicate, per-voter `runFreePassVoterWithContext` (voter-scoped → parallel-safe), CLI rewritten (`--steps fl-contrib\|sunbiz\|all`, `--concurrency`, `--start-after`, SIGINT cancel), dashboard free-pass actions get a **5,000-eligible guard** + chunked commits + arm_runs. Calhoun smoke: 736 voters/82 s at 4 workers. Still inline-only: `match-fec-index` API action (small-list path, low priority). |
| ENH-002 | ✅ 2026-07-06 | P2 | Re-run Alachua FEC match post-fixes | 40,374 re-processed in 29 min at 8 workers: **+29 leans (178 → 207), yield 0.44% → 0.51%**, conversion 82%; all timelines now itemize receipts. |
| ENH-001 | 🔴 | P2 | Sunbiz index performance | Prefix/trigram index on `officer_name_norm`; free pass slow at county scale. ROADMAP "Later". |
| ENH-005 | 🔴 | P2 | Label top Duval FL committees (researcher workflow) | After DEF-006, the remaining unresolved committees are the genuinely ambiguous ones — top of census: Palm Beach PBA (61 voters), Realtors PAC (36), Empower Parents PAC (19), NRA PVF (12). Labeling the top ~20 via the Committee lean labels manager + re-pass converts more Tier 2 settles. Census query in PROGRESS. |

## Features

| ID | Status | Pri | Title | Notes |
|---|---|---|---|---|
| FEAT-002 | ✅ 2026-07-05 | — | County-scale extract ingest CLI | `scripts/ingest-extract.ts`; born from DEF-003. |
| FEAT-001 | ✅ 2026-07-05 | — | Box-score dashboard Phase A | Pinned scoreboard + line score + one polling loop (D-029). |
