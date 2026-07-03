# LeanLink — Build Progress

Running status of what's actually built vs. stubbed vs. not started. The honest source of
truth for "is the product done?" Update as work lands. Last reviewed: 2026-06-30.

## Legend
✅ done & real · 🟡 works but partial / gated · ⬜ not started

## Where to pick up (continuity note — 2026-07-03, tiered/prepaid product)

**Shipped this session (build green; migrations 008/009 applied to Neon; billing engine
verified via `scripts/smoke-billing.ts`):** LeanLink now runs as the tiered, prepaid,
waterfall product the one-pager (`leanlink-one-pager.html`) sells.

- **Generic client intake** (`lib/generic-voter-list.ts`, `lib/intake/completeness.ts`):
  arbitrary CSV/TSV/paste/JSON with fuzzy headers, normalized to `ParsedFlVoterRecord` so
  every arm consumes it unchanged. Anchor gate = name + one of county/ZIP/address. No voter
  ID → `hashGenericVoter` (name+address+dob+county). Per-record completeness (thin/moderate/
  rich). New route `/dashboard/intake`; `sourceType=generic` branch in `POST /api/uploads`.
- **Waterfall settlement** (`lib/evidence/settlement.ts`): once an arm yields a confident
  lean (≥ `LEANLINK_SETTLE_THRESHOLD`, default 60) it settles the voter at the cheapest
  contributing tier and **all later arms skip it** (FEC claim, free-pass, batch worker
  work-sets). Sticky, set-once in `persistFusionForVoter`. Migration 008 `settled_*` cols.
- **Prepaid billing** (`lib/billing/*`, migration 009): `accounts` hold a balance;
  `billing_ledger` is the append-only money log; `rate_cards` (`default` + per-account
  overrides, editable, no redeploy). Charge points: **baseline** per accepted record,
  **tier fee** once per settled voter, **OSINT attempt** per paid run. APIs `/api/accounts`,
  `/api/accounts/[id]`, `/api/rate-cards`; UI `/dashboard/accounts` (create/deposit/invoice/
  ledger/rate editor). Scoreboard shows settled-by-tier + billed totals.

**Open decisions (reversible config):** OSINT hit currently bills attempt **+** tier-3 (set
`osint_attempt_usd=0` to bill tier-3 only). Provided-party is inert (no lean emitted) —
recommended treatment is "weak prior, arms still run," not pre-settle.

**Validate in prod:** create account → deposit → `/dashboard/intake` sample list billed to
it → run FEC/FL/OSINT → scoreboard "Settled by tier" + "Billed $…"; Billing console invoice
reconciles. Confirm settled voters are skipped by later arms (no new cost).

**Fix (same session):** `lib/fec/contributor-lookup.ts` now **retries transient FEC 5xx +
network errors** (was 429-only), so an intermittent FEC 502 no longer records a real donor as
a non-donor. Root-caused via `scripts/debug-fec.ts` — a known Calhoun donor (Dianne Foster,
4 FEC contributions) "missed" purely because FEC threw a 502 and the lookup aborted with no
retry. Rows that errored *before* this fix are cached as no-hit for their sweep job; re-run
FEC (fresh job) or re-ingest to pick them up.

## Where to pick up (continuity note — 2026-06-30, pre-deploy)

**⚠️ Before you stop for validation:** local changes are **not on Vercel** until **`git commit` +
`git push origin HEAD:main`** (run `npm run build` first). Prod still serves commit `20bbc88` until
then. Neon migration **`007_committee_lean.sql` is already applied**; dashboard/API for committee
lean and updated free-pass logic require deploy.

**Built locally (unshipped):**
- `(REP)` / `(DEM)` committee parser (`lib/committee-lean/infer.ts`)
- Layer-2 lean when entity bridge is `probable` · fusion weight **0.55×** for `fl_contrib_entity`
- **Committee lean** — uncertain queue + researcher labels (`007`) + modal + per-voter quick label
- **Researcher tiebreaker** — Street View + human estimate (`human_judgment` arm)
- `scripts/audit-layer2.ts` — Calhoun layer-2 committee audit

**FL & Sunbiz match** (dashboard button; was labeled “Run free pass”) is **not** federal FEC.
Large counties may hit the serverless time limit on Vercel until we add a background worker; CLI
fallback: `npx tsx scripts/run-free-pass.ts --county CAL`.

**Validate after deploy:** Calhoun demo path unchanged · optional **Committee lean** button ·
re-run free pass for new parsers/payloads · row 280 may show layer-2 Right from `(REP)`.

## Where to pick up (continuity note — 2026-06-29, post–voter filters)

**Shipped to prod:** Evidence accumulator + Tier 0 free pass + **voter list filters** (`main` · commit
`20bbc88`). Neon indexes: FL contrib **14.2M** (`2008-2026`), Sunbiz **20.6M** (`2026q2-cor0…cor9`).
Calhoun FEC sweep + free pass complete.

**Calhoun proof (`CAL_20250812.txt`, 736 NPA+ACT):**
- FEC: 27 raw → **3 confirmed** (`FEC✓`) → **3 fused lean** (Foster Left 95%; Hatcher Right 95%; Curl Right 95%)
- Free pass: **429** Sunbiz · **26** FL layer-2 entity · **3** FL layer-1 person · **344** household
- **733** fused `Undetermined` — expected (identity without partisan committee text)

**Inspect in prod:** Upload → Evidence accumulator → left pane filter pills **FEC✓** / **Layer-2** /
**Sunbiz** (expect **3** / **26** / **429** on Calhoun). Arms badges: `FEC✓` · `L2` · `SB`.
Demo: FEC rows 273/402/569 (lean) → Layer-2 row 224 or 280 (Sunbiz→entity, Undetermined lean).
Sunbiz match feeds layer-2 in the same free pass; lean only when committee text is partisan.

**Next best (priority order):**
1. **Professor walkthrough** — use filters above; explain identity vs lean
2. **Layer-2 lean audit** — do any of 26 entity donations carry partisan committee names worth labeling?
3. **Sunbiz lookup perf** — free pass ~84 min / 736 voters; prefix or trigram index on `officer_name_norm`
4. **Apify-modular eval** — Alachua curated subset vs `grok-full` (paid depth on promising rows only)
5. **Scorecard Tier-A metrics** — donation/media/civic % separate from social %

Docs updated: `enrichment-pipeline.html`, `evidence-accumulator-pitch.html` (continuity + filter tables).

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
| Generic client-list intake (CSV/paste/JSON, anchor gate, completeness) | ✅ | `lib/generic-voter-list.ts`, `lib/intake/completeness.ts`, `/dashboard/intake`. |
| Waterfall settlement (skip settled voters in later arms) | ✅ | `lib/evidence/settlement.ts`, migration 008; threshold `LEANLINK_SETTLE_THRESHOLD`. |
| Prepaid billing (accounts, ledger, rate cards, charge points) | ✅ | `lib/billing/*`, migration 009, `/dashboard/accounts`; verified `scripts/smoke-billing.ts`. |
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
| Evidence voter list filters (FEC✓, layer-2, Sunbiz) | ✅ | `evidence-workspace.tsx`, `GET .../evidence?list=1&fec=1` etc. |
| Tier-A OSINT query plan (donations, media, civic) | ✅ | `lib/enrichment/query-builder.ts` (Grok/Apify path). |
| Lean guardrails (signals in `identity_matches`) | ✅ | `applyInferenceGuardrails` — don't trust `lean_signals_found` alone. |
| Apify fetch layer (Google Search + web crawl) | 🟡 | `lib/apify/*`, `apify-modular` — actors need live eval. |
| Street View vision (exploratory in UI) | 🟡 | `lib/google/street-view.ts`, `street-view-vision.ts` — research arm, not merged into main lean. |
| Geo/precinct lean prior | ⬜ | Deferred per D-009. |
| Automated tests | ⬜ | None. See `docs/USE_CASES.md`. |

## Top of the backlog
1. **Professor demo** — Calhoun walkthrough via filter pills (FEC✓ 3 rows, Layer-2 26 rows).
2. **Layer-2 lean yield** — review 26 Calhoun entity donations for partisan committee labeling.
3. **Sunbiz index perf** — speed up `lookupSunbizOfficersForVoter` for county-scale free pass.
4. **Apify-modular eval** — Alachua curated subset; inspect actors and crawl quality.
5. **Scorecard Tier-A metrics** — donation/media/civic % alongside social %.
6. **Tests** — parsers, fusion, FEC/FL donation-lean, `buildResultsSql`.
7. **Batch re-enable criteria** — document $/voter + coverage thresholds before `LEANLINK_ENABLE_BATCH_INFERENCE`.

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