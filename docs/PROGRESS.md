# LeanLink — Build Progress

Running status of what's actually built vs. stubbed vs. not started. The honest source of
truth for "is the product done?" Update as work lands. Last reviewed: 2026-07-04.

## Legend
✅ done & real · 🟡 works but partial / gated · ⬜ not started

## Where to pick up (continuity note — 2026-07-04 later, FEC bulk index)

**FEC bulk index shipped (D-028, migration 013):** Tier 1 moves from the throttled FEC API
sweep (observed on Alachua: ~94 rows/hr average, 4–18 day projection, stall windows from FEC
429/5xx backoff that also dropped idle-in-transaction Neon connections) to a **local bulk
index** — county-scale matching in minutes. Staged FL-only, most-recent-cycle-first per owner
decision. Pieces: `migrations/013_fec_indiv_index.sql` (`fec_contributions` + snapshot
`completed_at` gate), `lib/reference-data/import-fec-indiv.ts` + `scripts/import-fec-indiv.ts`
(resumable loader: autocommit batches, unique `(snapshot_id, sub_id)`, live progress written
into the snapshot row every 30 s), `scripts/fec-indiv-status.mjs` (check-anytime progress),
`lib/fec/local-lookup.ts` (last-first name keys, exact + indexed-prefix), `lib/evidence/
fec-events.ts#buildFecIndexEvidenceEvent` (same arm 'fec'/tier 1; source `fec_indiv_index`),
`lib/fec/run-index-upload.ts` (chunked runner, standard claim predicate), `scripts/
run-fec-index.ts` (county-scale CLI, per-chunk commits) and a dashboard **Match FEC (local
index)** button (≤5,000 voters; larger → CLI). Runbook: `docs/SETUP.md` §8. **Not yet run:**
migration 013 must be applied, then download/load the 2024 cycle (~30 min), then match
Alachua's remainder locally — the crawling API sweep can be cancelled once the index pass
lands. Verified: FEC file format against fec.gov docs (21 pipe-delimited cols, SUB_ID unique,
MMDDYYYY dates); `fecNameNorm` unit cases; `tsc` clean.

**RESULTS (same evening):** 2024-cycle load: **3,981,111 FL rows** in ~12 min (58.2M lines
scanned, 7 malformed; snapshot `2024-fl` READY). Alachua index match: **40,546 voters in
3h12m** (~3.5/s, network-bound from the operator Mac) → 4,186 with name-matching rows (10.3%)
→ **247 identity-confirmed donors** → **178 settled at Tier 1** (132 Left / 46 Right ·
includes 6 from the cancelled API sweep, which was stopped at 802 voters processed).
Tier 1 lean yield on a real NPA county: **0.44%** — recalibrate the pitch's illustrative
example (which assumed ~2% at Tier 1) once Tier 2/3 actuals exist. Old API sweep: cancelled
2026-07-04 22:28Z. Next: Tier 2 free pass on the ~40k remainder (mind Sunbiz perf, backlog),
and/or backfill `indiv22`/`indiv20` cycles to raise Tier 1 yield (re-run the match after —
settled voters are skipped automatically).

## Where to pick up (continuity note — 2026-07-04, pricing + review controls)

**⚠️ Deploy gate:** migration **011** must be applied to Neon **before** this session's code is
pushed — the updated arm claim queries reference `voter_lean_fusion.review_status` /
`research_status`, which don't exist until 011 runs
(`node scripts/apply-migrations.mjs migrations/011_initiation_and_review.sql`). **Applied to
Neon 2026-07-04.** Build is green locally; an Alachua FEC sweep was running in prod during this
session (old code keeps working either way — 011 is additive).

**Pricing decisions (owner-confirmed, see D-026):** the seeded rate card **is** the client
pricing (baseline $0.03 / T1 $0.15 / T2 $0.25 / T3 $0.33 + $0.05 attempt) plus a **$2,500
initiation fee**; stage-gate advancement (no per-arm file round-trips); settlement stops
research by default with researcher re-enroll on top.

**Shipped this session:**
- **Initiation fee** (migration 011, `chargeInitiation` in `lib/billing/ledger.ts`): new
  `initiation` ledger kind, once-per-account partial unique index, `rate_cards.initiation_usd`
  (seeded $2,500). Billed at account creation (checkbox, default on) or via the "Charge
  initiation fee" button on the Billing console account detail.
- **Researcher review controls** (migration 011, `/api/voters/[id]/review`,
  `/api/uploads/[id]/re-enroll`): **Accept lean** freezes a voter's deliverable values
  (`persistFusionForVoter` early-returns on `review_status='accepted'`), excludes them from all
  arm claim queries, and writes a `human_judgment` `lean_review` audit event; **Reopen** clears
  it and re-fuses; **Re-enroll** (single voter or cohort: confidence ≤ 70 / FEC-settled tier 1 /
  withdraw) lets settled voters re-enter later arms without re-billing. Claim predicate now:
  locked → never; re-enrolled → claim even if settled; default → unsettled only
  (`claimFecSweepRows`, `runFreePassForUpload`).
- **Waterfall gate strip** (evidence workspace): eligible-remaining count, accepted/re-enrolled
  counts, projected max next-arm spend per tier (`summary.waterfall` via
  `getUploadEvidenceSummary` + `resolveRates`), cohort re-enroll buttons with confirms.
- **Deliverable provenance** (`/api/export/[uploadId]/deliverable`): `LeanLink Source` now lists
  **all** contributing arms (settled/billed arm first), new `LeanLink Status` column
  (accepted/fused/provisional/conflicted/unresearched), evidence = top 3 headlines, and a new
  **`?format=audit`** export — one row per evidence event (arm, source, identity band, lean
  signal, headlines, URLs) for full provenance.

**Market/pricing research (2026-07-04, summarized in D-026 + COST-ESTIMATES):** setup fees
$1k–$5k standard; per-match $0.02–$0.03 (append) to $0.07–$0.20 (skip-trace per hit) to
$0.50–$2.00 (investigative); modeled-partisanship pricing is quote-only market-wide; FEC
itemized donors ≈1.4% of adults (2020 cycle) → per-lean revenue is small next to the baseline
fee on NPA lists.

**Validate in prod after deploy:** create a throwaway account with initiation checkbox on →
ledger shows one `initiation` −$2,500 row (button disappears, second charge no-ops) → accept a
fused voter → `✓` in the voter list, later arms skip them, deliverable Status = `accepted` →
re-enroll FEC-settled cohort → waterfall-gate counts move, no new tier charges for re-settles →
`?format=audit` download.

**Posture evolution (same day, D-027):** "research only" is now scoped to what it always
protected — the FL DOS registration extracts (use-restricted data). Client-supplied lists on
per-client accounts proceed commercially. Migration **012** makes the guardrail structural:
`fl_extract` uploads can never carry a billing `account_id` (CHECK constraint; the upload
route also never sets one — verified live: both FL test uploads are unbilled, only the
`test001` generic import carries an account). Isolation Track A ↔ Track B is inherent:
upload-scoped evidence/fusion/household + disjoint hash schemes. **Migration 012 applied to
Neon 2026-07-04 and verified in the catalog** (`voter_uploads_fl_extract_unbilled` present
with `CHECK (source_type <> 'fl_extract' OR account_id IS NULL)`). Schema is current through
**012**.

**Brand A/B (same day):** parallel **OnRecord** variants of both client docs
(`onrecord-pitch.html`, `onrecord-one-pager.html`) for the naming decision — identical design,
name-only swap, so the A/B tests the name and nothing else. These are **generated mirrors** of
the `leanlink-*` sources (sed command in `docs/README.md`) — edit the LeanLink file, regenerate,
never hand-edit the OnRecord copies. Footers on all four now read "…by Four Plums, LLC"
(replaces "Michael Plumb / BitPlum"). **Descriptor decided (owner-approved 2026-07-04):
"Voter lean intelligence"** is the category line in mastheads/footers/taglines across all four
client docs; Florida/NPA specificity stays in the body copy. Still open: the name itself —
LeanLink vs OnRecord (owner will pick from the parallel docs).

**Client pitch (same day):** new `leanlink-pitch.html` — 3-page print-ready client pitch (what it
is / deliverable + audit + stage gates / confirmed pricing with a 25k worked example ≈ $4.5k,
~$1.45 per lean all-in). Framing: **fully managed service** (Michael operates the system on the
client's behalf; spend gated at every stage — clients never risk an accidental 40k run).
`leanlink-one-pager.html` pricing reconciled to D-026 ($2,500 / $0.03 / $0.15 / $0.25 /
$0.33 + $0.05; monthly platform fee removed). Sample-output names are fictitious.

## Lint gate restored (2026-07-04)

`npm run lint` had been failing on every tree state ("nextCoreWebVitals is not iterable" —
the flat config spread `eslint-config-next`'s eslintrc-format exports directly), so the
typecheck → lint → build pre-push gate was running blind on lint. Migrated to the ESLint CLI
(`eslint .`, FlatCompat-loaded `next/core-web-vitals` + `next/typescript`; see D-025) and
fixed the 8 findings the working linter surfaced (1 `prefer-const` error, unused
vars/imports, redundant useEffect deps, one justified `<img>` disable for a data-URL
Street View image). Gate is green again: lint 0 warnings, `tsc --noEmit` clean, build clean.

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

**Background FEC retry (same session):** new cron `/api/cron/fec-retry` (every 5 min,
`vercel.json`) + `lib/fec/retry-failed.ts` + migration 010 (`retry_attempts`/`last_attempt_at`
on `fec_lookup_results`). Re-attempts rows still carrying an `api_error`, capped at 8 attempts
spaced ≥10 min, throttled, in each row's user context — a recovered hit flows into the evidence
ledger and settles/bills automatically. So a flaky-then-recovered FEC self-heals without a manual
re-run.

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
| Initiation (kickoff) fee — $2,500, once per account | ✅ | Migration 011, `chargeInitiation`; billed at account creation (checkbox) or console button. |
| Researcher review: accept (freeze) / reopen / re-enroll | ✅ | Migration 011, `/api/voters/[id]/review`, `/api/uploads/[id]/re-enroll`; claim queries honor locked/re-enrolled. |
| Waterfall gate (eligible remaining + projected next-arm spend) | ✅ | `summary.waterfall` in `getUploadEvidenceSummary`; strip + cohort re-enroll in evidence workspace. |
| Background FEC retry cron (heals transient failures) | ✅ | `lib/fec/retry-failed.ts`, `/api/cron/fec-retry`, migration 010. |
| Client deliverable export (input file + lean/confidence/source/status/evidence per row) | ✅ | `/api/export/[uploadId]/deliverable`; multi-arm Source, Status column, `?format=audit` per-event provenance export. |
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
| FEC whole-file sweep (batch, Open API) | ✅ | Calhoun 736/736; now the **fallback** path — throttled ~450/hr max, days at county scale. |
| FEC bulk index (local Tier 1, D-028) | 🟡 | Code shipped (migration 013, loader, status script, lookup, runner, dashboard button); **awaiting first data load** (SETUP §8). |
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

### Product layer — next up (2026-07-04)
1. **Upload delete/archive UX** — a DELETE endpoint exists (`app/api/uploads/[id]`, wired in the
   dashboard), but we want a real **manage-uploads** experience: discoverable delete, plus a
   soft **archive** (hide without losing the ledger/billing history), ideally bulk. Consider an
   `archived_at` column on `voter_uploads` and a filter on the uploads list.
2. **Name a pasted list** — generic pastes are stored as `filename = 'pasted-list'`. Add a
   "List name" input to `components/generic-intake.tsx` (the route already accepts `filename`),
   so uploads are identifiable in the inventory + deliverable filename.
3. **OSINT charge policy decision** — confirm whether an OSINT hit should bill attempt **+**
   tier-3 (current) or tier-3 only (`osint_attempt_usd = 0`). Money-sensitive; owner call.
4. **Party-prior decision** — provided party is currently inert (no lean emitted). Recommended:
   emit a low-weight tier-0 prior the arms confirm/override, never billed for echoing. Owner call.
5. **FL-scoped FEC bulk-load** — ✅ **shipped 2026-07-04 (D-028, migration 013)**; remaining:
   apply 013, load the 2024 cycle (SETUP §8), backfill older cycles, then retire the Alachua
   API sweep in favor of the local pass.
6. **HTML artifact redraw** — `enrichment-pipeline.html` / `evidence-accumulator-pitch.html` have
   2026-07-04 catch-up banners but still frame the research-POC; give them a billing/waterfall-aware pass.
   *(Partially addressed 2026-07-04: new client-facing `leanlink-pitch.html` (3-page, print-ready,
   confirmed pricing, managed-service framing) is now the flagship; `leanlink-one-pager.html`
   pricing reconciled to D-026 — the two internal spec HTMLs still need their pass.)*

### Research POC
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