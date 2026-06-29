# LeanLink — Build Progress

Running status of what's actually built vs. stubbed vs. not started. The honest source of
truth for "is the product done?" Update as work lands. Last reviewed: 2026-06-29.

## Legend
✅ done & real · 🟡 works but partial / gated · ⬜ not started

## Where to pick up (continuity note — 2026-06-29, post–Tier 0 validation)

**Shipped to prod:** Evidence accumulator UI + Tier 0 free pass (`main` deployed). Neon indexes:
FL contrib **14.2M** (`2008-2026`), Sunbiz **20.6M** (`2026q2-cor0…cor9`). Calhoun free pass done.

**Calhoun proof (`CAL_20250812.txt`, 736 NPA+ACT):**
- FEC: 27 raw → **3 confirmed** (`FEC✓`) → **3 fused lean** (Foster Left 95% ActBlue×3; Hatcher Right 95%;
  Curl Right 95% WinRed/Trump JFC)
- Free pass: **429** Sunbiz · **26** FL layer-2 entity · **3** FL layer-1 person · **344** household
- **733** fused `Undetermined` — expected (identity without partisan committee text)

**Inspect in prod:** Upload → Evidence accumulator → `FEC✓` in Arms column, or name-search layer-2
examples (rows 57, 224, 280). Timeline = audit; fused lean only when arms supply ideology.

**Next best (priority order):**
1. **Professor walkthrough** — demo rows 273/402/569 (lean) + row 224 or 280 (Sunbiz→layer-2, Undetermined lean)
2. **UI filters** — voter list: `FEC✓ only`, `has layer-2`, `has Sunbiz` (no filter today; name search only)
3. **Sunbiz lookup perf** — free pass ~84 min / 736 voters; prefix or trigram index on `officer_name_norm`
4. **Layer-2 lean audit** — do any of 26 entity donations carry partisan committee names worth labeling?
5. **Apify-modular eval** — Alachua curated subset vs `grok-full` (paid depth on promising rows only)
6. **Scorecard Tier-A metrics** — donation/media/civic % separate from social %

Docs updated: `enrichment-pipeline.html`, `evidence-accumulator-pitch.html`. CLI: `scripts/run-free-pass.ts`.

## Where to pick up (continuity note — 2026-06-29, morning)

**Evidence accumulator (D-023):** Multi-arm ledger (`evidence_events`), fusion (`voter_lean_fusion` →
`lean_results`), dashboard split-pane **Evidence accumulator** above **Research lab**. FEC sweep
writes events per voter; **Sync FEC → ledger** backfills completed sweeps. **Anchor profile**
(`lib/anchor/*`): name variants (Maria↔Marcia, email maiden) + co-address household index;
**Tier 0 Free Pass:** `006_reference_data.sql` — `fl_contributions` + `sunbiz_officers` bulk indexes;
import scripts; dashboard **Run free pass** (layer 2 entity donations). **ACT** = FL registration
status (active on rolls), not political engagement. Anchor profile; FEC; scorecard → ledger.
Migrations through `006`.

## Where to pick up (continuity note — 2026-06-28)

**Safe POC workflow (use this):** Upload ingests voters only (no Grok). Select an upload →
**Analyze** section: enter a **test subset** of row indices (defaults to ~7 curated rows/county),
pick a **test** (enrichment, scorecard, Street View exploratory, or **FEC contributor lookup**),
run. Full-file **Run Analysis Job** is **disabled** until we validate cost and quality
(`LEANLINK_ENABLE_BATCH_INFERENCE` unset = off).

**Latest architecture:** Four Grok enrichment modes — `grok-full` (social-first + x_search +
Tier-A OSINT), `apify-modular` (Apify Google Search + page crawl + Street View exploratory
→ Grok synthesize only), `modular-targeted`, `modular-synthesize`. **Plus** direct FEC Open API
lookup (`lib/fec/contributor-lookup.ts`, `POST /api/enrichment/fec`) — no Grok, structured
Schedule A hits for disambiguation eval. Grok is **not** replaced by Apify or FEC; each is a
testable arm.

**Dashboard (2026-06-28):** Analyze UI restructured — subset input, single test picker, pipeline
mode for enrichment/scorecard only. Removed compare-all-modes and Street View strict from UI
(strict mode still exists in API for now). Results preview shows **row index** column.

**Scorecard findings so far:**
- **Calhoun (~736 rows):** identity probable ~90–95%; social ~0%; lean labeled ~0%.
- **Alachua (~40,552 rows):** upload ingested; full job started once (10 rows) then
  **cancelled**; scorecard on 7 curated rows — social ~1/7; lean still sparse.
- **FEC via Grok `site:fec.gov`:** poor yield in limited tests — direct API lookup added to
  measure true hit rate (validation in progress).

**Open questions (next session):**
1. **FEC validation** — run FEC lookup on curated subset; record `rows_with_hits` and whether
   hits disambiguate identity or supply lean signals.
2. Run `apify-modular` on Alachua curated rows; compare `apify_runs` / `fetched_text_chars` vs
   `grok-full` on same subset.
3. Tune Apify actors (`GET /api/enrichment/apify-config`) and crawl URL filtering (prefer
   FEC/media over Facebook login walls).
4. Professor field validation for **exploratory Street View** (separate from OSINT lean).
5. Scorecard: add Tier-A hit-rate metrics (`donation|media|civic`) separate from social %.
6. Re-enable batch only after median $/voter and coverage targets are met.

**Key env (production):** `XAI_API_KEY`, `GOOGLE_MAPS_API_KEY`, `APIFY_API_TOKEN`,
optional `FEC_API_KEY` (falls back to `DEMO_KEY` locally) — do **not** set
`LEANLINK_ENABLE_BATCH_INFERENCE` until deliberate.

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
| **Full-file batch inference** | 🟡 | Code exists; **disabled by default** (D-020). |
| Results dashboard: sort, filters, row index, hash+reveal | ✅ | `row_index` from `voter_records` in preview. |
| CSV / JSON export | ✅ | `app/api/export/[uploadId]`. |
| Turnout & opposition-mobilization scoring | ✅ | Real math in `lib/inference.ts`. |
| Grok live-search OSINT + lean inference | ✅ | `lib/enrichment/grok-pipeline.ts` + `inferLean` when `XAI_API_KEY` set. |
| Enrichment modes (4) | ✅ | `grok-full`, `apify-modular`, `modular-targeted`, `modular-synthesize`. |
| Analyze UI: subset + test picker | ✅ | `app/dashboard/page.tsx`, `lib/test-row-indices.ts`. |
| Enrichment test + scorecard APIs | ✅ | `POST /api/enrichment/test`, `scorecard` accept `rowIndices`. |
| FEC direct contributor lookup (subset) | ✅ | `POST /api/enrichment/fec` — 0/7 on curated Calhoun validation. |
| FEC whole-file sweep (batch) | ✅ | Calhoun 736/736; 27 raw, 3 confirmed, 3 fused lean (ActBlue / Harris / WinRed). |
| Tier 0 Free Pass (FL + Sunbiz indexes) | ✅ | Indexes in Neon; Calhoun run; multi-shard Sunbiz lookup. |
| Free pass CLI | ✅ | `scripts/run-free-pass.ts --county CAL`. |
| FEC identity scoring + disambiguate | ✅ | `lib/fec/identity-match.ts`, `donation-lean.ts`, `fec-disambiguate`. |
| Evidence accumulator + fusion | ✅ | `005_evidence_ledger.sql`, `lib/evidence/*`, Evidence workspace UI. |
| Tier-A OSINT query plan (donations, media, civic) | ✅ | `lib/enrichment/query-builder.ts` (Grok/Apify path). |
| Lean guardrails (signals in `identity_matches`) | ✅ | `applyInferenceGuardrails` — don't trust `lean_signals_found` alone. |
| Apify fetch layer (Google Search + web crawl) | 🟡 | `lib/apify/*`, `apify-modular` — actors need live eval. |
| Street View vision (exploratory in UI) | 🟡 | `lib/google/street-view.ts`, `street-view-vision.ts` — research arm, not merged into main lean. |
| Geo/precinct lean prior | ⬜ | Deferred per D-009. |
| Automated tests | ⬜ | None. See `docs/USE_CASES.md`. |

## Top of the backlog
1. **Professor demo** — Calhoun Evidence accumulator walkthrough (FEC lean rows + layer-2 identity rows).
2. **Evidence list filters** — `FEC✓`, layer-2, Sunbiz hit in `evidence-workspace.tsx`.
3. **Sunbiz index perf** — speed up `lookupSunbizOfficersForVoter` for county-scale free pass.
4. **Layer-2 lean yield** — review 26 Calhoun entity donations for partisan committee labeling.
5. **Apify-modular eval** — Alachua curated subset; inspect actors and crawl quality.
6. **Scorecard Tier-A metrics** — donation/media/civic % alongside social %.
7. **Tests** — parsers, fusion, FEC/FL donation-lean, `buildResultsSql`.
8. **Batch re-enable criteria** — document $/voter + coverage thresholds before `LEANLINK_ENABLE_BATCH_INFERENCE`.

## Spec
- Doc index: [`docs/README.md`](README.md)
- Enrichment & inference pipeline: [`docs/enrichment-pipeline.html`](enrichment-pipeline.html)
- Design decisions: [`docs/DECISIONS.md`](DECISIONS.md)
- Cost bands: [`docs/COST-ESTIMATES.md`](COST-ESTIMATES.md)

## Known constraints / watch-items
- Requires Vercel **Pro** (worker `maxDuration = 800`) when batch is enabled.
- Grok ≈ **$0.03/voter** at `grok-full` — never run 40k without explicit opt-in.
- FEC `DEMO_KEY` is rate-limited — set `FEC_API_KEY` in Vercel for production eval volume.
- Single-user only by design; `user_id` is the email everywhere.
- `voter_hash` uniqueness is per user — re-processing conflicts on `lean_results` insert.