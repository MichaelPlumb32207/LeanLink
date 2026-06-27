# LeanLink — Build Progress

Running status of what's actually built vs. stubbed vs. not started. The honest source of
truth for "is the product done?" Update as work lands. Last reviewed: 2026-06-27.

## Legend
✅ done & real · 🟡 works but stubbed/partial · ⬜ not started

## Pipeline

| Area | Status | Notes |
|---|---|---|
| Google sign-in, single-user lockout | ✅ | `lib/auth.ts`, restricted to `ALLOWED_USER_EMAIL`. |
| Registration extract parsing (38-field) + NPA/Active filter | ✅ | `lib/fl-voter-registration.ts`. |
| Voting-history extract parsing + turnout scoring | ✅ | `lib/fl-voter-history.ts`. |
| Upload → hash → batch ingest | ✅ | `app/api/uploads`, `lib/hash.ts`. |
| Job runner: claim/process/heartbeat, self-chaining worker | ✅ | `app/api/jobs/[id]/worker`. |
| Cron sweeper (stall recovery) | ✅ | `app/api/cron/job-sweeper`, every minute. |
| Job cancel / upload delete | ✅ | `app/api/jobs/[id]/cancel`, `app/api/uploads/[id]`. |
| Results dashboard: sort, filters, hash+reveal voter column | 🟡 | Pushed sort/filter; hash reveal local. |
| CSV / JSON export | ✅ | `app/api/export/[uploadId]`. |
| Turnout & opposition-mobilization scoring | ✅ | Real math in `lib/inference.ts`. |
| Grok live-search OSINT + lean inference | 🟡 | `lib/enrichment/grok-pipeline.ts` — needs `XAI_API_KEY` + live eval. |
| Enrichment test endpoint + dashboard UI | ✅ | `POST /api/enrichment/test`, row-index picker. |
| Modular OSINT fetchers (S1–S5) | ⬜ | Deferred per D-008; pivot if Grok-only insufficient. |
| Geo/precinct lean prior | ⬜ | Deferred per D-009. |
| Automated tests | ⬜ | None. See `docs/USE_CASES.md`. |

## Top of the backlog
1. **Evaluate Grok live-search** on Calhoun sample via Test enrichment — inspect citations,
   match quality, latency, cost per voter.
2. **Run full job with XAI_API_KEY** on Vercel; measure coverage (% Undetermined vs labeled).
3. **Pivot decision** — keep Grok-only or split OSINT into modular fetchers.
4. **Tests** — parsers, `buildResultsSql`, `applyInferenceGuardrails`.
5. **Cleanup** — remove dead `mockInferLean` from `lib/job-runner.ts`.

## Spec
- Enrichment & inference pipeline: [`docs/enrichment-pipeline.html`](enrichment-pipeline.html)
- Design decisions D-008–D-012: [`docs/DECISIONS.md`](DECISIONS.md)

## Known constraints / watch-items
- Requires Vercel **Pro** (worker `maxDuration = 800`).
- Grok call per voter ≈ slow + costly at scale — batch carefully.
- Single-user only by design; `user_id` is the email everywhere.
- `voter_hash` uniqueness is per user — re-processing conflicts on `lean_results` insert.