# LeanLink — Build Progress

Running status of what's actually built vs. stubbed vs. not started. The honest source of
truth for "is the product done?" Update as work lands. Last reviewed: 2026-06-27.

## Legend
✅ done & real · 🟡 works but partial / gated · ⬜ not started

## Where to pick up (continuity note — 2026-06-27)

**Safe POC workflow (use this):** Upload ingests voters only (no Grok). Per-voter evaluation
via dashboard **Test enrichment**, **POC scorecard** (curated ~7 rows per county), and
**Street View** (strict / exploratory). Full-file **Run Analysis Job** is **disabled** until
we validate cost and quality (`LEANLINK_ENABLE_BATCH_INFERENCE` unset = off).

**Latest architecture:** Four enrichment modes — `grok-full` (social-first + x_search +
Tier-A OSINT), `apify-modular` (Apify Google Search + page crawl + Street View exploratory
→ Grok synthesize only), `modular-targeted`, `modular-synthesize`. Grok is **not** replaced
by Apify; Apify is the auditable fetch layer when we want deterministic citations.

**Scorecard findings so far:**
- **Calhoun (~736 rows):** identity probable ~90–95%; social ~0%; lean labeled ~0%.
- **Alachua (~40,552 rows):** upload ingested; full job started once (10 rows) then
  **cancelled**; scorecard on 7 curated rows — social ~1/7; lean still sparse.

**Open questions (next session):**
1. Run `apify-modular` on Alachua curated rows now that `APIFY_API_TOKEN` is in Vercel —
   compare `apify_runs` / `fetched_text_chars` vs `grok-full` on same row.
2. Tune Apify actors (`GET /api/enrichment/apify-config`) and crawl URL filtering (prefer
   FEC/media over Facebook login walls).
3. Professor field validation for **exploratory Street View** (separate from OSINT lean).
4. Optional: multi-mode comparison CSV export for side-by-side audit.
5. Re-enable batch only after median $/voter and coverage targets are met.

**Key env (production):** `XAI_API_KEY`, `GOOGLE_MAPS_API_KEY`, `APIFY_API_TOKEN` —
do **not** set `LEANLINK_ENABLE_BATCH_INFERENCE` until deliberate.

## Pipeline

| Area | Status | Notes |
|---|---|---|
| Google sign-in, single-user lockout | ✅ | `lib/auth.ts`, restricted to `ALLOWED_USER_EMAIL`. |
| Registration extract parsing (38-field) + NPA/Active filter | ✅ | `lib/fl-voter-registration.ts`. |
| Voting-history extract parsing + turnout scoring | ✅ | `lib/fl-voter-history.ts`. |
| Upload → hash → batch ingest | ✅ | `app/api/uploads`, `lib/hash.ts`. No Grok on upload. |
| Job runner: claim/process/heartbeat, self-chaining worker | ✅ | Gated by `lib/batch-inference.ts`. |
| Cron sweeper (stall recovery) | ✅ | Skips re-trigger when batch inference disabled. |
| Job cancel / upload delete | ✅ | `app/api/jobs/[id]/cancel`, `app/api/uploads/[id]`. |
| **Full-file batch inference** | 🟡 | Code exists; **disabled by default** (D-016). |
| Results dashboard: sort, filters, hash+reveal voter column | 🟡 | Pushed sort/filter; hash reveal local. |
| CSV / JSON export | ✅ | `app/api/export/[uploadId]`. |
| Turnout & opposition-mobilization scoring | ✅ | Real math in `lib/inference.ts`. |
| Grok live-search OSINT + lean inference | ✅ | `lib/enrichment/grok-pipeline.ts` + `inferLean` when `XAI_API_KEY` set. |
| Enrichment modes (4) + compare | ✅ | `grok-full`, `apify-modular`, `modular-targeted`, `modular-synthesize`. |
| Enrichment test endpoint + dashboard UI | ✅ | `POST /api/enrichment/test`, mode picker, row index. |
| POC scorecard (curated rows) | ✅ | `POST /api/enrichment/scorecard`, county-aware suggested rows. |
| Tier-A OSINT query plan (donations, media, civic) | ✅ | `lib/enrichment/query-builder.ts`. |
| Lean guardrails (signals in `identity_matches`) | ✅ | `applyInferenceGuardrails` — don't trust `lean_signals_found` alone. |
| Apify fetch layer (Google Search + web crawl) | 🟡 | `lib/apify/*`, `apify-modular` — actors need live eval. |
| Street View vision (strict + exploratory) | 🟡 | `lib/google/street-view.ts`, `street-view-vision.ts` — research arm, not merged into main lean. |
| Geo/precinct lean prior | ⬜ | Deferred per D-009. |
| Automated tests | ⬜ | None. See `docs/USE_CASES.md`. |

## Top of the backlog
1. **Apify-modular eval** — same curated rows as scorecard; inspect actors and crawl quality.
2. **Actor selection** — default `apify/google-search-scraper` + `apify/website-content-crawler`; override via env after testing.
3. **Crawl URL policy** — skip social login walls; prefer Tier-A domains from SERP.
4. **Field validation** — professor compares exploratory Street View cues vs ground truth.
5. **Tests** — parsers, `applyInferenceGuardrails`, `buildResultsSql`.
6. **Batch re-enable criteria** — document $/voter + coverage thresholds before flipping `LEANLINK_ENABLE_BATCH_INFERENCE`.

## Spec
- Enrichment & inference pipeline: [`docs/enrichment-pipeline.html`](enrichment-pipeline.html)
- Design decisions: [`docs/DECISIONS.md`](DECISIONS.md)
- Cost bands: [`docs/COST-ESTIMATES.md`](COST-ESTIMATES.md)

## Known constraints / watch-items
- Requires Vercel **Pro** (worker `maxDuration = 800`) when batch is enabled.
- Grok ≈ **$0.03/voter** at `grok-full` — never run 40k without explicit opt-in.
- Single-user only by design; `user_id` is the email everywhere.
- `voter_hash` uniqueness is per user — re-processing conflicts on `lean_results` insert.