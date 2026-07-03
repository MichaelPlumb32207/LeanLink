# LeanLink — Use Cases & Test Cases

Each use case pairs the intended behavior with the test cases that prove it. This doubles as
the QA checklist and the spec for the (not-yet-written) automated test suite. Status reflects
whether the behavior is currently implemented.

Legend: ✅ implemented · 🟡 partial/mocked · ⬜ not built

---

## UC-1 — Sign in (single authorized user) ✅
**As** the authorized researcher, **I can** sign in with Google and **no one else can**.

| ID | Test | Expected |
|---|---|---|
| T1.1 | Sign in as `ALLOWED_USER_EMAIL` | Reaches dashboard. |
| T1.2 | Sign in as any other Google account | Rejected; bounced to `/login`. |
| T1.3 | Hit `/dashboard` or `/api/uploads` unauthenticated | 401 / redirect to `/login`. |

## UC-2 — Upload a registration extract ✅
**As** the researcher, **I can** upload a FL registration `.txt` and have only NPA + Active
voters ingested.

| ID | Test | Expected |
|---|---|---|
| T2.1 | Upload a valid 38-field extract | Rows inserted; only NPA + Active kept; count shown. |
| T2.2 | Upload a file with no eligible voters | 400 "No eligible NPA active voters found". |
| T2.3 | Upload a malformed/wrong-width file | 400 with "Expected 38 tab fields, got N". |
| T2.4 | Row with trailing empty columns (no email) | Parses; no field misalignment (no `trim()` damage). |
| T2.5 | Each ingested row has a `voter_hash` | Hash present; PII is hashed, not stored raw beyond `raw_data`. |

## UC-3 — Attach voting history (turnout scoring) ✅
**As** the researcher, **I can** add a `*_H_*` history file to enrich turnout/primary scoring.

| ID | Test | Expected |
|---|---|---|
| T3.1 | Upload registration + matching history file | `votersWithHistory` > 0; summaries attached. |
| T3.2 | Drop an `_H_` file onto the registration drop zone | Auto-routed to the history slot. |
| T3.3 | Upload with no history file | Succeeds; turnout scores limited/zeroed, not an error. |
| T3.4 | Voter present in registration but absent from history | turnout_score 0, propensity "Low". |

## UC-4 — Run the analysis job (full file) 🟡
**As** the researcher, **I could** run a job that scores every voter — **currently disabled**
unless `LEANLINK_ENABLE_BATCH_INFERENCE=true` (D-020). Use UC-10 for POC instead.

| ID | Test | Expected |
|---|---|---|
| T4.0 | Run job with batch inference **disabled** | 403 from `/api/uploads/[id]/run`; dashboard has no Run button. |
| T4.1 | Run a job with batch **enabled** | Job → running → completed; every row gets a `lean_results` row via `inferLean`. |
| T4.2 | Run while a job is already active | Returns the existing job, no duplicate. |
| T4.3 | Worker hits its time budget mid-run | Re-triggers itself; remaining rows finish across invocations. |
| T4.4 | Kill the worker mid-run | Cron sweeper resets stuck rows; re-triggers only if batch enabled. |
| T4.5 | Cancel a running job | Status `cancelled`; in-progress rows reset to pending. |
| T4.6 | Opposition-mobilization score | Matches `turnout_score × confidence/100 × oppositionFactor(lean, ballot_favors)`. |

## UC-5 — Review & filter results ✅
**As** the researcher, **I can** sort and filter results, with correct behavior at small and
large upload sizes.

| ID | Test | Expected |
|---|---|---|
| T5.1 | Sort by each column (name/lean/confidence/turnout/primary/opposition) | Correct order both directions. |
| T5.2 | Filter by lean / confidence range / turnout / opposition range | Rows narrow correctly. |
| T5.3 | Small upload (under threshold) | Sort/filter happen in-browser, no re-fetch. |
| T5.4 | Large upload (over threshold) | Sort/filter re-fetch server-side; counts (total/filtered) correct. |
| T5.5 | Client and server paths on same data | Produce the same ordering/filtering. |
| T5.6 | Results preview shows row index | `row_index` column matches ingest order (0-based). |

## UC-6 — Export ✅
**As** the researcher, **I can** export results as CSV or JSON for offline analysis.

| ID | Test | Expected |
|---|---|---|
| T6.1 | Export CSV | Header + one row per result; evidence quoted/escaped; scores present. |
| T6.2 | Export JSON | Full result objects incl. `audit_log`, `matched_social`. |
| T6.3 | Export contains `voter_hash`, not re-derivable raw PII columns | Hash present; export is research-safe. |

## UC-7 — Manage uploads ✅
| ID | Test | Expected |
|---|---|---|
| T7.1 | List uploads | Shows each ingest with latest job status/counts. |
| T7.2 | Delete an upload | Upload + records + results + jobs cascade-deleted. |
| T7.3 | One user cannot see another's data | RLS blocks cross-user reads (single-user today, future-proofs multi-user). |

## UC-8 — Real lean inference (Grok/xAI) ✅
**As** the researcher, **I can** get lean + confidence from Grok with guardrails when
`XAI_API_KEY` is set (per-voter test path; batch gated).

| ID | Test | Expected |
|---|---|---|
| T8.1 | Test enrichment with `grok-full` | `lean`/`confidence` from model; `model_version` = Grok id. |
| T8.2 | Grok call fails | Mock fallback + error in evidence (batch row) or 500 (test API). |
| T8.3 | No signals in matches | Guardrails force `Undetermined`, cap confidence. |
| T8.4 | Compare all modes (API only) | `compare: true` on test API still runs all modes; removed from dashboard UI (D-022). |

## UC-9 — OSINT persona linkage 🟡
**As** the researcher, **I want** each voter linked to candidate online personas from public
sources. Identity resolution is strong; social/lean coverage still thin on scorecard samples.

| ID | Test | Expected |
|---|---|---|
| T9.1 | Resolve via Grok OSINT | `identity_matches` + `matched_social` when profiles found. |
| T9.2 | No confident match | `identity_resolution_status` none/ambiguous; lean Undetermined. |
| T9.3 | Provenance logged | `audit.sources`, citations / `apify_runs` per mode. |
| T9.4 | Tier-A hits (donation/media/civic) | Matches use platform `donation|media|civic` with `signals[]`. |

## UC-10 — POC test subset (Analyze UI) ✅
**As** the researcher, **I can** define a small row-index subset and run one test against it
without county-scale spend.

| ID | Test | Expected |
|---|---|---|
| T10.1 | Load suggested row indices | County defaults (~7 rows) populate subset input on upload select. |
| T10.2 | Edit subset (comma-separated) | Parser accepts `0, 13, 7`; invalid tokens ignored. |
| T10.3 | Test enrichment + active row | Single-voter JSON + `usage.cost_usd` for chosen pipeline mode. |
| T10.4 | Scorecard on subset | `rowIndices` passed to API; metrics: identity %, social %, lean %. |
| T10.5 | Street View exploratory | Preview image + `lean_street_view` on active row (not merged into OSINT lean). |
| T10.6 | `apify-modular` on curated row | `apify_runs`, `pipeline_steps`, `street_view_context` in response. |
| T10.7 | Apify config endpoint | `GET /api/enrichment/apify-config` lists actors and limits. |

## UC-11 — FEC contributor lookup 🟡
**As** the researcher, **I can** query FEC Schedule A directly for names in my test subset
without Grok spend.

| ID | Test | Expected |
|---|---|---|
| T11.1 | FEC lookup on subset | `POST /api/enrichment/fec` returns per-row `lookup.contributions`. |
| T11.2 | No FEC API key | Falls back to `DEMO_KEY` or returns API error if rate-limited. |
| T11.3 | Voter not found at row index | Row entry with `error: Voter record not found`. |
| T11.4 | Dashboard FEC test | JSON shows `rows_with_hits` / `row_count`; no `usage.cost_usd`. |

## UC-12 — Generic client-list intake ✅
**As** the operator, **I can** ingest an arbitrary client voter list (no FL voter file) via
`/dashboard/intake`, anchor-gated and scored for completeness.

| ID | Test | Expected |
|---|---|---|
| T12.1 | Paste CSV with header `name,county,address,city,zip,dob` | Rows normalized to `ParsedFlVoterRecord`; count shown. |
| T12.2 | `"Last, First"` quoted name; commas in address | Name split correctly; address preserved (quoted-field parser). |
| T12.3 | Row with a name but no county/ZIP/address | Rejected at the anchor gate with a reason; other rows still accepted. |
| T12.4 | Row with only name + ZIP vs. full address + employer | Completeness `thin` vs `rich`; `reachable` gates FL/Sunbiz off without a street. |
| T12.5 | JSON array with aliased keys (`firstName`, `Zip`) | Parsed via header aliasing. |
| T12.6 | Same person twice within one list | Deduped on `hashGenericVoter` (name+address+dob+county). |

## UC-13 — Waterfall settlement (skip settled voters) ✅
**As** the operator, **I want** a confidently-leaned voter excluded from later, pricier arms.

| ID | Test | Expected |
|---|---|---|
| T13.1 | FEC yields lean ≥ `LEANLINK_SETTLE_THRESHOLD`, identity confirmed/probable | `voter_lean_fusion.settled_tier=1`; set-once. |
| T13.2 | Run FL/Sunbiz after a tier-1 settle | Settled voters excluded from the free-pass work-set (no new events). |
| T13.3 | FEC hit but lean Undetermined or below threshold | Not settled; falls through to next arm. |
| T13.4 | Multiple arms contribute a lean | Settles at the **cheapest** contributing tier. |

## UC-14 — Prepaid billing (accounts, waterfall pricing) ✅
**As** the operator, **I can** prepay an account and have research deducted per tier.

| ID | Test | Expected |
|---|---|---|
| T14.1 | Create account + deposit (`/dashboard/accounts`) | Balance reflects deposit; one `deposit` ledger row. |
| T14.2 | Ingest a list billed to the account | One **baseline** charge per accepted record; idempotent on re-upload. |
| T14.3 | A voter settles at tier N | One tier-N `charge`, once per voter (partial unique index). |
| T14.4 | Each paid OSINT run | One `attempt` charge (hit or miss), not deduped. |
| T14.5 | Intake with balance < baseline total | 400 "Insufficient prepaid balance"; nothing ingested. |
| T14.6 | Edit default fee / set per-account override | New batches bill at resolved rates; prior ledger rows unchanged (rate snapshot). |
| T14.7 | Unbilled batch (`account_id` NULL) | No ledger rows; arms run free. |
| T14.8 | `scripts/smoke-billing.ts` | All ✓; rolls back; "Billing engine verified". |
