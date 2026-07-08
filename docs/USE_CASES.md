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
| T2.4 | County-scale file via `scripts/ingest-extract.ts` (dashboard path caps at Vercel's ~4.5 MB body limit) | Same parser/filter/hash as the route (shared `insertVoterRecords`); per-chunk commits with progress; upload `pending` → `ready` only when complete. Verified on Duval: 146,599 rows in ~102 s (~1,430/s). |
| T2.5 | Kill the CLI mid-ingest, re-run | Errors with "unfinished ingest exists … --resume <id>"; `--resume` continues from the last committed row_index (deterministic parse order). |
| T2.6 | `--resume` against a `ready` upload or wrong filename | Clear error; nothing written. |
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
| T9.5 | Capped cohort dry-run (ENH-015) | `run-osint-cohort.ts --county DUV --limit 100 --dry-run` selects the eligible cohort, prints richness + projected max cost, makes **zero** Grok calls / no spend. Verified: Duval → 100 eligible (rich: 100/100 email+history). |
| T9.6 | Hard spend cap | Cap binds on `max(reported spend, processed × --est-usd)`; the run stops before a voter that could breach `--max-usd`, and never processes more than `max-usd / est` voters even if the API reports $0 cost. Sequential — no fuzzy overshoot. |
| T9.7 | Track isolation | Settlement/tier-fee bill only when the upload has a billing account; FL-extract research uploads carry none → measured-but-unbilled (D-027). |

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
| T11.5 | Load FEC bulk cycle (`scripts/import-fec-indiv.ts`) | Snapshot row visible immediately (`LOADING` in `fec-indiv-status.mjs`); `READY` with row_count on completion; interruption + re-run resumes (no duplicate sub_ids). |
| T11.6 | `match-fec-index` on an upload ≤5,000 voters (dashboard button) | Evidence events `arm=fec, source=fec_indiv_index`; identity scoring + donation lean identical to API path; settled voters skipped. |
| T11.7 | `scripts/run-fec-index.ts --upload-id …` on a county | Chunked progress lines; per-chunk commits; re-run after interruption resumes; no snapshot → clear error pointing at the import script. |
| T11.8 | Lookup during an in-progress load | In-progress snapshot (`completed_at IS NULL`) is never matched; latest READY snapshot used instead. |
| T11.9 | Confirmed donor whose committee has a party code in the committee master (name itself pattern-free) | Lean derived from the party code (committee shown as "NAME (REP/DEM)"); evidence line cites "recipient party code" (D-030 regression). |
| T11.10 | Confirmed donor with **no** derivable lean | Evidence still itemizes receipts — `$amt → COMMITTEE (PARTY) · date`, top 5 + "+N more"; `payload.receipts` populated; researcher can judge from the timeline (D-030 regression — the "row 113" case). |

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
| T13.5 | Re-enrolled settled voter (`research_status='re_enrolled'`) | Re-enters later arm work-sets; new evidence may revise lean/confidence. |
| T13.6 | Settled + re-enrolled voter gains more evidence | **No second tier charge** (partial unique index holds). |

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
| T14.9 | Create account with "Bill initiation fee" checked | One `initiation` ledger row −$2,500 (rate card); balance reflects it. |
| T14.10 | Charge initiation again (button or re-create) | No-op — once per account, ever (partial unique index); UI reports "already charged". |
| T14.11 | Create account with the checkbox off | No initiation row; "Charge initiation fee" button available on the account detail. |
| T14.12 | Attach an `account_id` to an `fl_extract` upload (direct SQL) | Rejected by `voter_uploads_fl_extract_unbilled` CHECK — FL registration data is research-track only (D-027). |

## UC-15 — Client deliverable export ✅
**As** the operator, **I can** hand the client back their own list with our lean, confidence,
source, and evidence appended to every row.

| ID | Test | Expected |
|---|---|---|
| T15.1 | `GET /api/export/{id}/deliverable?format=csv` | CSV of all input rows in original order + `LeanLink Lean/Confidence/Source/Status/Evidence` columns. |
| T15.2 | Upload ingested with original headers (`raw_data._source`) | Deliverable echoes the client's exact columns/order. |
| T15.3 | Upload predating `_source` | Falls back to normalized columns (name/county/address/city/state/zip/dob/email). |
| T15.4 | Voter still Undetermined | Row present with `LeanLink Lean=Undetermined`, confidence 0 (not dropped). |
| T15.5 | `format=json` | JSON array of row objects with appended keys. |
| T15.6 | Voter fused from multiple arms | `LeanLink Source` lists **all** contributing arms, settled (billed) arm first (e.g. `FEC federal + Sunbiz → entity`). |
| T15.7 | Status column values | `accepted` (researcher), `fused`/`provisional`/`conflicted` (fusion), `unresearched` (no fusion row). |
| T15.8 | `format=audit` | One CSV row per evidence event: Row, Name, Arm, Source, Identity Band, Probable Match, Lean Signal, Signal Confidence, Evidence, URLs, Recorded At. |

## UC-16 — Researcher review: accept / reopen / re-enroll ✅
**As** the researcher, **I can** accept a fused lean as final (freezing it while research
stops), reopen it, or push settled voters back into later arms — without ever re-billing a
settlement.

| ID | Test | Expected |
|---|---|---|
| T16.1 | Accept a voter with a determinate fused lean | `review_status='accepted'`; `human_judgment`/`lean_review` audit event; `✓` in voter list; deliverable Status `accepted`. |
| T16.2 | Accept a voter whose fused lean is Undetermined | 400 "No fused lean to accept". |
| T16.3 | Any arm runs after acceptance | Voter never claimed (FEC sweep, free pass); if evidence is added manually, fusion does **not** rewrite lean/confidence (freeze guard in `persistFusionForVoter`). |
| T16.4 | Reopen an accepted voter | Lock cleared; fusion re-runs and catches up on evidence that arrived while frozen. |
| T16.5 | Re-enroll a settled voter (button) | `research_status='re_enrolled'`; claimed by later arms despite settlement. |
| T16.6 | Re-enroll an **accepted** voter | 400 — reopen first. |
| T16.7 | Cohort re-enroll `maxConfidence=70` / `tierLte=1` | Only matching settled, unaccepted voters flagged; response reports count. |
| T16.8 | Withdraw re-enrollments | `research_status` cleared for the upload; waterfall-gate counts update. |
| T16.9 | Waterfall controls strip | Re-enroll/withdraw buttons + projected max next-arm spend (billed uploads only); the eligible/accepted counts render in the pinned box score (UC-17, D-029). |

## UC-17 — Box-score progress visibility 🟡
**As** the operator, **I can** answer "where are we?" for any upload at a glance — totals
pinned at the top, per-arm contribution below, live progress while an arm runs — accurately
enough to paste into a client status update. (Phase A shipped; Phase B = `arm_runs` live
progress incl. CLI runs, migration 014.)

| ID | Test | Expected |
|---|---|---|
| T17.1 | Select an upload with evidence | Pinned scoreboard shows records in / leans settled / conflicted / accepted / still in research; values match `evidence-summary`. |
| T17.2 | Scroll through workspace, research lab, results | Scoreboard stays pinned (`sticky`); no content ghosts through it in any of the three themes. |
| T17.3 | Line score | Arms in tier order (T0 party → T1 FEC → T2 FL/Sunbiz → T3 OSINT); a never-run arm shows only eligible-in (est.) with an em-dash elsewhere. |
| T17.4 | Alachua sanity | fec row: processed 40,552 · identity hits 253 · lean signals 178 · settled-here 178; eligible T2/T3 = 40,374 (records − T1 settles). |
| T17.5 | Start an FEC API sweep | Live chip + progress strip appear within 5s; polling tightens to 5s, returns to 30s when done; hidden tab pauses polling. |
| T17.6 | Numbers appear exactly once | Old stats grid / scoreboard panel / arm badges are gone; re-enroll buttons remain under "Waterfall controls". |
| T17.7 | Uploads list mini-score | Rows with settlements show "N settled · N accepted · N conflicted". |
| T17.8 | Start a county run from the CLI (`run-fec-index.ts`) | Current-inning strip appears in the pinned box score within ≤30 s (idle poll) — progress bar, rate, ETA, heartbeat age, `CLI` chip; uploads list shows the pulsing live dot. |
| T17.9 | Kill the CLI mid-run | Heartbeat age climbs; strip flags "stalled?" past 5 min; next `startArmRun` reaps the dead run as failed after 10 min and claims the slot. |
| T17.10 | Start a second run for the same arm while one is live | Rejected ("active run already exists") — `uniq_arm_runs_active` holds. |
| T17.11 | Dashboard free-pass button on an upload with >5,000 eligible | 400 with the `run-free-pass.ts` CLI hint — the in-request pass never attempts county scale. |
| T17.12 | `run-free-pass.ts --steps fl-contrib --concurrency N` | Household+person steps only (arm `fl_contrib`); chunk-committed, resumable via `--start-after`; strip shows hits + settled-at-arm as "leans". |
| T17.13 | Upload with unresolved FL committees | **"On base — runners in scoring position"** strip directly under the line score: N committees · M eligible voters could gain a fused lean, with a "Label committees" action opening the manager; label one committee → both counts shrink on the next poll (no re-pass needed for the counter). Numbers render only there (button stays plain). |
| T17.14 | Voter-list filters (DEF-011) | Typing in the name box debounces (~300ms) — no per-keystroke fetch; toggling an arm pill re-fetches once and reacts on the **first** click (latest-wins guard; no 2nd-click needed); a 5s box-score poll does **not** reload the list; the header shows a live "N voters match · showing first 1000" total that updates as filters toggle. |
| T17.14 | Active run deviates from history (≥1,000 processed, priors exist) | Amber ⚠ line in the run strip: "hit rate X% vs typical Y% (median of N prior runs) — source drift?"; below 1,000 processed or with no priors → silent (documented: first-ever runs get no flags). |
| T17.15 | STATE badge after a `completed` run of a hit-only arm (Sunbiz) | Reads **COMPLETE**, never PARTIAL, even though its event count (46,124) is far below eligible (146,129) — STATE follows `runs.recent[].status`, not event coverage (DEF-010). PROCESSED shows real coverage (`max(processed_count, voters_touched)` = 146,121). PARTIAL appears only for a `cancelled`/`failed` run. |

## UC-18 — Golden-voter canaries ✅
**As** the operator, **I can** run known-answer synthetic voters through identity → lean →
fusion and catch scoring regressions before they touch a county
(`npx tsx scripts/smoke-golden-voters.ts`; `--offline` skips the DB parity check).

| ID | Test | Expected |
|---|---|---|
| T18.1 | Fixtures (a)–(c) | Party-coded committees fire (DEF-005/006 regressions); conduits classify (ActBlue/WinRed). |
| T18.2 | Fixture (d) | Same-name wrong-geography stays unconfirmed: no lean, no receipt lines. |
| T18.3 | Fixture (e) | Equal-strength Left+Right confirmed events fuse to conflicted/Undetermined. |
| T18.4 | Fixture (f) | Employer PAC: no lean but itemized receipts + `payload.receipts` + `scorer_v` (D-030 regression). |
| T18.5 | Fixture (g) | DB registry classifies 17 probes identically to the code fallback in both scopes (seed-parity guard); zero invalid patterns. |
| T18.6 | Fixture (h) | Anomaly math: Duval zero-settle shape flags; below-floor and healthy runs stay silent. |
| T18.7 | Fixtures (i)–(j) | Sunbiz address gate (ENH-012): name+zip+street match → `confirmed`; a name+zip collision at a **different** street caps at `ambiguous` (≤0.54) and its event never clears the identity gate — the 98,650-hit / 0-settle Duval shape can no longer settle. |
| T18.8 | Fixtures (k)–(l) | fl_contrib identity upgrades (ENH-013): street corroboration lifts a name-only match from `ambiguous` → `probable`; a stale zip match (18 yr) scores below a recent one (recency penalty). |
| T18.9 | Fixture (m) | Re-pass diff math (ENH-010): a tightened re-pass (scorer_v 2→3) that drops 2 spurious bridge-leans reports `leans_lost=2`/`leans_gained=0`, leaves real + frozen settles untouched, counts the accepted voter as frozen, and lists both losses in `notable`. |
| T18.10 | Fixture (n) | Committee label wiring (ENH-018): a confirmed FEC donor to an unlabeled committee (Harris Victory Fund — no party code, no pattern) is Undetermined; add a `Left` committee label and the same donor recovers `Left` with `lean_signals_found` — the FEC scorer now honors `committee_lean_labels`. |
| T18.11 | Exit code | Any ✗ → exit 1 (CI-able); `smoke-billing.ts` still passes alongside. |

## UC-19 — Re-pass with before/after diff (ENH-010) ✅
**As** the operator, **I can** bracket a re-score with a delta report so improvements to
scoring logic ship as an evidence-backed diff instead of a silent change.

| ID | Test | Expected |
|---|---|---|
| UC-19·H | `snapshot --county DUV` → run a re-pass → `report --county DUV` | Baseline JSON captured (146,599 voters); report prints settles gained/lost, leans gained/lost/flipped, confidence movement, settled-by-arm, and a notable sample. Read-only; no DB writes; no migration. |
| UC-19·E1 | `report` before any `snapshot` | Fails cleanly: "Baseline not found — run snapshot before the re-pass first." |
| UC-19·E2 | Baseline for a different upload than `--upload-id`/`--county` resolves to | Aborts: "Baseline is for upload X, not Y." |
| UC-19·E3 | Self-diff (report immediately after snapshot, no re-pass) | All deltas zero; population reconciles (Duval: 478 settled = 470 fec + 8 fl_contrib, 524 partisan). |
| UC-19·E4 | Voter frozen via UC-16 accept | Counted in `frozen_skipped`; never appears in gained/lost leans (fusion early-returns for accepted). |

## UC-20 — Committee classification (recover stuck donors) ✅
**As** the operator, **I can** classify the unresolved committees confirmed donors gave to, so
donors to party-less committees (Harris Victory Fund, union PACs, the Lincoln Project) settle —
using Grok on *committees* (public, finite, knowable), not on private voters.

| ID | Test | Expected |
|---|---|---|
| UC-20·H | `classify-committees.ts --county DUV` | Gathers the FEC+FL unresolved census ranked by donor count; Grok classifies; prints partisan proposals (lean/confidence/reason) + the count of donors behind them. No writes without `--apply`. |
| UC-20·E1 | Bipartisan corporate PAC (CSX Good Government, Realtors, GuideWell) | Returned `Undetermined` and **not** written — no manufactured signal. Unrecognized committees → Undetermined, not guessed. |
| UC-20·E2 | `--apply` then `run-fec-index` re-pass | Agent labels written (`source='agent'`); the FEC scorer now settles those donors; `repass-diff` reports the gained settles. |
| UC-20·E3 | Agent vs human precedence | Agent never overwrites a `researcher`/`import` label (`skipped_human`); a human override reclaims `source='researcher'` and locks the committee against the agent (verified in a rolled-back tx). |
| UC-20·E4 | `--dry-run` | Census + counts only, zero Grok calls, zero spend. |
| UC-20·E5 | Billed account | CLI warns; default is propose-only (a lean settles + bills its donors, so review precedes `--apply`). |
| UC-20·E6 | Committee manager — review agent labels (ENH-018-UI) | The "Labeled" section shows each label's **source badge** (Grok/Researcher), confidence, and Grok's reasoning; no loading flash (empty state gated behind `!loading`). |
| UC-20·E7 | Edit / delete a label | Edit an agent label's lean → re-fuses affected voters + reclaims `source='researcher'` (locks out the agent, skipped by a later `classify --apply`). Delete → reverts affected voters to pattern-lean/Undetermined. |
| UC-20·E8 | Re-fuse pending | A labeled-but-unfused population shows a "{N} voters behind {M} committees await re-fusion" strip (manager + box-score "on base"); **Re-fuse now** books them (`refusionAllPendingForUpload`). Guarded at 150 voters inline (>that → CLI hint). Verified on Duval: 304 pending → 344 re-fused, Tier-2 settles 8→10. |

## UC-21 — Guided workbench navigation (ENH-019) 🟡
**As** the operator, **I can** click any inning in the line score to expand that arm's details
and run its actions in place — no hunting through a scattered button list. (Phase 1 shipped
2026-07-08: clickable innings + arm detail panels, plus the D-036 scoreboard cleanup. Phase 2's
guide rail was built and **removed** on the owner's screen-read — D-037; navigation lives in the
line score + ON BASE strip + arm panels, no linear spine. Phase 3 = review/deliver stages.)

| ID | Test | Expected |
|---|---|---|
| UC-21·H | Click each core inning row (party, FEC, FL contrib, Sunbiz, OSINT) | Row toggles a detail panel (one open at a time; click again collapses): role + honest explainer, this arm's game log, and the arm's actions. **No funnel numbers** — the per-arm stats live once, in the line-score row (scoreboard single-source, D-036). |
| UC-21·E1 | Keyboard operation | Rows are `role="button"`, `tabIndex=0`, `aria-expanded`; Enter/Space toggles the panel; ▸/▾ affordance flips. |
| UC-21·E2 | FEC panel | Shows the local-index **Match FEC** button (D-028 primary) + a freshness note pointing at the bulk-snapshot reload (`import-fec-indiv.ts`). The live-API sweep is **not** offered in the UI (D-035, owner: never run a per-voter API sweep in prod). |
| UC-21·E3 | Sunbiz (hit-only) panel | The explainer carries the "a completed run with zero settles is the arm working as designed" framing (DEF-010); STATE badge unchanged. No duplicated funnel. |
| UC-21·E4 | OSINT panel | Informational only — shows the `run-osint-cohort.ts --dry-run` command + "owner-approved with --max-usd" note; **no run button** (posture held). |
| UC-21·E5 | Over-cap arm | When eligible > 5,000 the panel renders the `run-*.ts --upload-id … --concurrency 8` CLI hint instead of the inline button (mirrors the server guard); the hint states the cap, **not** the row's eligible/rows count (D-036 — no restated number). |
| UC-21·E6 | One polling loop preserved | Expanding panels adds no fetch/poll; the page-level `useEvidenceSummary` remains the only interval loop; a live run shows `RunStrip` in the panel with no CTA. |
| UC-21·E7 | Old step buttons still work | Steps-1–5 buttons remain this phase and share the one `use-evidence-actions` hook (same endpoints, same 5,000/complete-rerun guards, same confirm prompt). |
| UC-21·E8 | Game log = schedule, not a second line score (D-036) | A finished run reads "✓ completed · walked N rows · cli · date" + **one** off-board diagnostic ("N raw candidates before the identity gate"); it never repeats the row's ID hits / lean signals. Run vocab matches the board: **ID hits** (not "confirmed"), **lean signals** (not "leans"), **raw candidates** (not "hits"). |
| UC-21·E9 | Conflicted / Accepted are non-zero-only (D-036) | The top bar shows `Conflicted` and `Accepted` **only when > 0** (both hidden on a fresh/auto-settled upload). Records-in · leans-settled · still-in-research are always shown. Committee counts render once, in the ON BASE strip — the fl_contrib panel shows only the "Label committees" action, no count. |
| UC-21·E10 | No guide rail / no pipeline cards (D-037) | The workspace has **no** linear pipeline spine or step cards — a guide rail was tried and removed on the owner's screen-read (it duplicated the line score + ON BASE strip; the linear metaphor mis-signalled). Navigation is: the **line score** (progress + clickable innings), the **ON BASE strip** (committee opportunities + Re-fuse/Label), and the **arm panels** (actions). Every arm/committee/deliver action stays reachable without the rail. |
