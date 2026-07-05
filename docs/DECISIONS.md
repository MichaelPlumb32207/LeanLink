# LeanLink — Decision Log (ADR-lite)

Why the project looks the way it does. Newest first. Each entry: the decision, the reason,
and what it overrides. This is the context the plan HTML loses when choices change — keep it
current as design shifts.

---

## D-028 · FEC bulk index replaces the API sweep as primary Tier 1
**Decision:** Bulk-load FEC federal individual contributions (Florida-filtered, staged
most-recent-cycle-first) into Neon as the third reference index (`fec_contributions`,
migration 013), and make the local index the primary Tier 1 arm. The throttled Open-API
sweep stays as fallback (freshness, spot checks). **Why:** the 4-second API throttle puts a
40k-county sweep at 4–18 days of fragile self-chained serverless execution (observed live on
Alachua, 2026-07-04: ~94 rows/hr average with stall windows from FEC 429/5xx backoff, which
also killed idle-in-transaction Neon connections); the same match against a local index runs
in minutes, immune to rate limits. Also raises Tier 1 hit rate (cheap to load many cycles of
donation history) and makes turnaround a sellable feature. **Mechanics:** mirrors the
fl_contrib/Sunbiz pattern (reference_snapshots + normalized-name index) with two deliberate
differences — autocommit batches + unique `(snapshot_id, sub_id)` for **resumable** loads
(re-run to continue; `--fresh` to reload), and **live progress in the snapshot row**
(`row_count` + notes JSON) readable any time via `scripts/fec-indiv-status.mjs`; lookups only
use snapshots with `completed_at` set, so a mid-load index is never matched against. Names
match in FEC's "last first" order with generational suffixes stripped (`fecNameNorm`);
committee names/party are denormalized from the cycle's committee master at load time.
Evidence lands on the same arm ('fec', tier 1, source `fec_indiv_index`) so fusion,
settlement, and billing are unchanged. **Overrides:** the FEC API sweep as the default Tier 1
path (D-021 remains for per-voter lookups and fallback).

## D-027 · Two-track use posture: research-only is scoped to FL-extract data
**Decision (owner, 2026-07-04):** The "research/validation only" posture (D-005) was always a
guardrail on the *data source* — the FL DOS voter-registration extracts used during
exploration, which carry use restrictions excluding commercial/marketing use — not on the
enrichment activity itself. Exploration is complete; commercial engagements now proceed on
**client-supplied lists**. The posture becomes two-track: **Track A** — anything derived from
FL registration extracts (Calhoun/Alachua test uploads, professor work) stays research-only,
is never billed, and never enters a client deliverable; **Track B** — client-supplied lists on
per-client accounts, enriched from public records only, are commercial. **Guardrails made
structural:** migration 012 adds `voter_uploads_fl_extract_unbilled` (`CHECK (source_type <>
'fl_extract' OR account_id IS NULL)`) so an FL-extract upload can never carry a billing
account; the upload route never sets one on that path (now documented in-code); isolation is
already inherent — evidence/fusion/household are upload-scoped and the two intake paths use
disjoint identity hashes (`hashVoterPii` voterId-keyed vs `hashGenericVoter`
name/address/dob-keyed). **Retained on both tracks:** OSINT-only (no data brokers — now a
client-facing product promise), no race/gender inputs, withheld labels on conflict, no
resale/pooling. **Client responsibility:** the lawful basis for a list a client supplies is
the client's — capture in engagement terms. **Overrides:** D-005's blanket research-only
posture and its counsel-review tripwire framing (the tripwire attached to the FL-extract
data, which remains protected).

## D-026 · Pricing confirmed + researcher review controls (accept / re-enroll)
**Decision (pricing, owner-confirmed 2026-07-04):** Keep the migration-009 seeded rate card as
the client pricing — $0.03 baseline/record, $0.15 tier-1 (FEC), $0.25 tier-2 (FL/Sunbiz),
$0.33 + $0.05/attempt tier-3 (OSINT) — and add a **$2,500 initiation (kickoff) fee** as a
first-class rate-card fee + ledger kind (`initiation`, once per account ever, migration 011).
**Why:** Market comparables (researched 2026-07-04): setup fees of $1k–$5k are standard for
SMB data-service implementations; charged-on-match is the dominant append convention
($0.02–$0.03/match commodity append, $0.07–$0.20/hit batch skip-trace, $0.50–$2.00
investigative); **no modeled-partisanship vendor publishes per-score pricing** (L2/TargetSmart/
Catalist/i360 all quote-only), so there is no public like-for-like anchor. The ascending tier
ladder was kept over a flatter $0.18/$0.20 alternative because "deeper research costs more" is
the waterfall's sales story and tier 2 genuinely costs more to serve. At realistic FEC hit
rates on NPA lists (low single digits), the **baseline fee is the volume revenue driver**, not
the per-lean fees.

**Decision (review controls):** Billing settlement and research continuation are now separate
switches on `voter_lean_fusion` (migration 011). Default keeps the hard waterfall (settled ⇒
excluded). New researcher actions: **Accept** (`review_status='accepted'`) affirms the fused
lean — freezes the deliverable values (fusion stops rewriting them), excludes the voter from
all arms, and logs a `human_judgment` audit event; **Reopen** clears it; **Re-enroll**
(`research_status='re_enrolled'`, per voter or per cohort via `/api/uploads/[id]/re-enroll`)
pushes settled voters back into later arms — billing unaffected (settlement fee is
partial-unique-indexed, charged once ever). Advancement stays a **dashboard stage-gate**
(waterfall-gate strip: eligible-remaining count + projected max next-arm spend + explicit arm
buttons) — an exported file is never the control mechanism (no per-arm file round-trips;
export works at any stage). **Why:** the researcher needs to accept a lean without losing the
option to keep an NPA in research, and needs to see cost exposure before advancing a tier;
file round-trips would drift from the evidence ledger and re-ingest at cost. **Overrides:**
D-024's "later arms always skip settled voters" is now the *default*, not an invariant.

## D-025 · Lint gate: migrate `next lint` → ESLint CLI (flat config via FlatCompat)
**Decision:** `npm run lint` now runs `eslint .` directly. `eslint.config.mjs` loads
`next/core-web-vitals` + `next/typescript` through `@eslint/eslintrc`'s `FlatCompat`
(new explicit devDependency) and ignores `.next/`, `out/`, `build/`, `next-env.d.ts`, and
`.claude/**` (linked git worktrees that background agents create inside the repo — full repo
copies whose build artifacts would otherwise drown `eslint .`).
**Why:** the old config spread `eslint-config-next/core-web-vitals.js` into the flat-config
array, but `eslint-config-next` 15.x still exports eslintrc-format objects — every run died
with "nextCoreWebVitals is not iterable", so the pre-push lint gate was dead. `next lint` is
also deprecated (removed in Next 16), so this is the codemod-recommended migration (done by
hand for determinism). Rule expectations unchanged; the 8 findings the working gate surfaced
were fixed in the same commit. **Overrides:** the scaffold's `"lint": "next lint"` script.

## D-024 · Tiered / prepaid / waterfall billing + generic client intake
**Decision:** Turn the evidence engine into the product the one-pager sells. (1) **Generic
intake** — accept an arbitrary client list (name + one of county/ZIP/address required; no FL
voter file, no voter ID), normalized to `ParsedFlVoterRecord` so arms are unchanged
(`lib/generic-voter-list.ts`); per-row completeness score. (2) **Waterfall settlement** — a
confident lean (≥ `LEANLINK_SETTLE_THRESHOLD`) settles a voter at the cheapest contributing
tier and later arms skip it (`lib/evidence/settlement.ts`). (3) **Prepaid billing** — an
`account_id` holds a balance; charge **baseline** per record, **tier fee** per settled lean,
**OSINT attempt** per paid run; editable `rate_cards` (default + per-account overrides);
ledger `amount_usd` snapshots the rate (`lib/billing/*`, migration 009). **Why:** the value
is inferring lean for *unknowns*, priced by how much research it took; a hard waterfall (vs
pure fusion) makes the per-tier price meaningful and saves real API spend on already-found
voters. **Chose "hard stop above threshold"** over pure fusion (accuracy vs cost) and a
**baseline-per-record + attempt-priced OSINT** (vs pure success-only) to stop thin-data lists
consuming expensive attempts for free. **Overrides:** the `stack-spec.md` "No billing system"
non-goal. **Open (reversible config):** OSINT hit bills attempt + tier-3 (`osint_attempt_usd=0`
for tier-3 only); provided-party emits no lean yet (weak-prior recommendation). Single-operator
now; `account_id` is the seam to future multi-tenant login.

## D-023 · Multi-arm evidence accumulator + fused lean
**Decision:** Add `evidence_events` ledger (per voter, per arm) and `voter_lean_fusion` with
`lib/evidence/fusion.ts` rules. Each arm appends: identity band/score, optional lean signal,
evidence strings, URLs, cost. FEC sweep and OSINT test runs write events; fusion upserts
`lean_results` when status is `fused` or `provisional`. Dashboard **Evidence accumulator**
(split-pane command bar + voter timeline) sits above **Research lab** (former Analyze).
Arm registry in `lib/evidence/arms.ts` — pluggable per research effort. Pitch:
`docs/evidence-accumulator-pitch.html`. **Why:** Researchers need explainable lean labels built
from auditable sources, not one-shot model output; supports adding/removing arms (FEC, OSINT,
media, household) without rewriting the core.

## D-022 · Analyze UI: test subset + single test picker
**Decision:** Dashboard **Analyze** section takes an editable comma-separated **row-index
subset** (defaults to county curated ~7 rows), then one **test** choice: enrichment (single
active row), scorecard (all subset rows), Street View exploratory (single active row), or FEC
contributor lookup (all subset rows). Pipeline mode applies to enrichment/scorecard only.
Removed dashboard **Compare all modes** and **Street View strict** (API paths may remain).
**Why:** Researchers iterate on a fixed POC panel; one clear run action reduces mis-clicks and
cost. Strict Street View was redundant with exploratory for the professor validation workflow.

## D-021 · Direct FEC Open API for contributor lookup
**Decision:** Add `lib/fec/contributor-lookup.ts` + `POST /api/enrichment/fec` calling FEC
Schedule A (`/v1/schedules/schedule_a/`) by contributor name + FL state/city/zip. Optional
`FEC_API_KEY` (falls back to `DEMO_KEY`). Grok `site:fec.gov` queries remain in Tier-A plan but
are a poor substitute for structured search. **Why:** Limited tests showed near-zero yield from
indirect FEC web search; direct lookup is free, auditable, and isolates donation hit rate before
spending Grok credits. Disambiguation still manual (no employer on FL extract).

## D-020 · Batch inference disabled until POC validated
**Decision:** Full-file `Run Analysis Job` is blocked unless
`LEANLINK_ENABLE_BATCH_INFERENCE=true`. Dashboard shows per-voter tools only; `/api/uploads/[id]/run`
and the worker return 403; cron sweeper skips re-triggers. **Why:** A 40k-county upload at
~$0.03/voter Grok cost is ~$1.2k accidental spend; per-voter scorecard (~7 rows) is the
intended eval path until coverage and $/voter are acceptable.

## D-019 · Tier-A lean sources in query plan
**Decision:** Query planner includes donations/FEC, regional local media, and civic/professional
filings alongside social and directory queries. Prompts treat `donation|media|civic` platform
matches as valid lean signal carriers when `signals[]` has explicit ideology. **Why:** Social
profiles are sparse for rural NPAs; public donations and press quotes are higher-signal when
identity aligns.

## D-018 · Street View as separate research arm
**Decision:** Google Street View Static + Grok vision in `strict` (signage only) and `exploratory`
(visible-cue heuristics) modes. Output is `lean_street_view` — **not** merged into main OSINT
`lean`. Exploratory feeds `apify-modular` synthesis as weak context only. **Why:** High-quality
residential signal when imagery exists; professor can validate stereotypes in the field separately
from OSINT integrity rules.

## D-017 · Apify as fetch layer, Grok as synthesizer
**Decision:** `apify-modular` mode: Phase A parallel = Apify Google Search (top N query-plan
queries) + Street View exploratory; Phase B = Website Content Crawler on top organic URLs;
Phase C = Grok **synthesize only** (no `web_search`/`x_search`) with same lean guardrails.
Actors configurable via `APIFY_*` env; audit in `apify_runs`. **Why:** Deterministic, auditable
fetch without replacing Grok; pivot from D-008 "evaluate Grok first" once cost/auditability
required modular fetch.

## D-016 · Lean guardrail: signals must live in matches
**Decision:** `lean_signals_found` and labeled lean require non-empty `identity_matches[].signals[]`
with explicit ideological content — do not trust model `lean_signals_found` alone. **Why:**
Model sometimes claimed lean with empty signals; research integrity requires quotable public evidence.

## D-015 · Social-first OSINT + x_search + email insights
**Decision:** `grok-full` runs social-first query plan (email username variants, possible
maiden/alias from local-part, phone) with **x_search + web_search**; directories last.
`email_insights` derived from voter-file email (e.g. `ALICE.HAM` → maiden token `ham`).
**Why:** Row 13 proved contact info reaches people-search sites but not social profiles
with directory-first prompting.

## D-013 · Split identity resolution from lean inference
**Decision:** `identity_resolution_status` (found the right person?) is separate from `lean`
(ideological label). Directory/property hits count as identity even when `lean` stays
`Undetermined`. **Why:** All-Undetermined was uninformative — Ezra had a confirmed directory
match but no social/ideology; that is a meaningful POC finding, not a pipeline failure.

## D-014 · Modular enrichment modes for cost comparison
**Decision:** Four testable modes: `grok-full` (social-first + x_search + Tier-A), `apify-modular`
(Apify fetch + Grok synthesize), `modular-targeted` (query planner + capped searches),
`modular-synthesize` (no search baseline). Batch jobs would use `ENRICHMENT_MODE` when batch is
enabled; dashboard used to offer **Compare all modes** per voter (removed from UI in D-022;
`compare` flag on test API may remain). **Why:** ~$330/10k at full Grok search — compare modes
on curated rows before any county-scale run.

## D-012 · Primary history = mobilization only
**Decision:** PRI/PPP counts feed turnout/opposition context only — never infer party lean
from primary participation (FL history extract has no party-of-primary field). **Why:**
Avoid false precision; NPA primary choice isn't in our data.

## D-011 · No match → Undetermined
**Decision:** If OSINT resolution is `none` or `best_match_score` &lt; 0.25, force
`lean = Undetermined` and cap `confidence` at 35. **Why:** Research integrity; don't guess
without public evidence.

## D-010 · Hard exclude race/gender
**Decision:** Race and gender are never passed to Grok prompts or used in rules. **Why:**
Bias risk and weak signal for individual NPA lean; professor will want clean methodology.

## D-009 · OSINT-only lean (no geo prior v1)
**Decision:** Precinct/district geographic priors are **disabled** for lean inference in v1.
**Why:** Cleaner research story; add weak geo prior later only if OSINT coverage is too thin.

## D-008 · Grok live-search first for OSINT
**Decision:** v1 enrichment = xAI Responses API with `web_search` + `x_search`. Evaluate via
`POST /api/enrichment/test`, **POC scorecard**, and mode compare before county-scale batch.
**Why:** Fastest path to watch what Grok searches and returns. **Update (2026-06-27):** Apify
modular fetch added (D-017) for auditable retrieval; Grok remains synthesizer. **Spec:**
`docs/enrichment-pipeline.html`.

## D-007 · Living-docs artifact set
**Decision:** Standard complement = `README.md`, `CLAUDE.md`, `docs/README.md` (index),
`docs/SETUP.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/ROADMAP.md`, `docs/USE_CASES.md`,
`docs/COST-ESTIMATES.md`, `docs/enrichment-pipeline.html`, `docs/CLAUDE.md`, `LICENSE`.
`docs/USE_CASES.md` embeds its test cases (no separate `TEST_PLAN.md`); `docs/ROADMAP.md` added
2026-07-05 as the forward-looking counterpart to `PROGRESS.md`. `USER_GUIDE.md` (from the global
8-doc standard) is still deferred — single-operator, and `SETUP.md` covers the workflow. **Why:** Survive context drift
between sessions and across teammates (Michael, Claude, Grok Build); make the project
handover-ready. **Deferred:** CONTRIBUTING/SECURITY/CHANGELOG — overkill for a single-user POC.

## D-006 · Proprietary license
**Decision:** Closed source, all rights reserved (`LICENSE`). **Why:** Keep the option to
sell or license exclusive ownership; an OSS license would let anyone fork it. The actual
transfer of ownership happens via sale contract, not the repo file.

## D-005 · Educational-research use posture (OSINT-only)
**Decision:** Output is for a UF professor's research/validation/teaching — never to contact,
target, or resell person-level data. Enrichment is **OSINT-only** for the POC; no commercial
data brokers. **Why:** Data-broker / TCPA / CCPA regimes primarily bite on *contacting or
targeting* individuals — the research-only posture is what keeps the POC clear. Also,
vendors named in the original plan (Clearbit/FullContact) are moving targets. **Overrides:**
the original plan's commercialization framing and Clearbit/FullContact enrichment.
**Tripwire:** any shift toward outreach/marketing/resale → counsel review first.
**Scope narrowed by D-027 (2026-07-04):** this posture now applies to FL-DOS-extract-derived
data only; client-supplied lists proceed commercially on per-client accounts.

## D-004 · History-aware mock before Grok
**Decision:** Fallback mock in `lib/inference.ts` when `XAI_API_KEY` is missing or Grok
errors. **Why:** Pipeline stays runnable in dev without API spend. **Superseded for prod:**
when `XAI_API_KEY` is set, Grok live-search runs (D-008).

## D-003 · xAI/Grok for inference
**Decision:** Grok/xAI is the inference engine (house default). **Why:** Per org AI-vendor
preference. Wired via `lib/enrichment/grok-pipeline.ts` + `lib/xai/client.ts` (Responses API
+ `web_search`). See `docs/CLAUDE.md` for endpoint/model verification.

## D-002 · Serverless background jobs (no n8n)
**Decision:** Self-chaining Vercel worker + per-minute cron sweeper, instead of n8n or an
external queue. **Why:** One fewer system to run/own; the worker re-triggers itself to beat
function time limits, and the sweeper self-heals stalls. **Cost:** requires Vercel **Pro**
(`maxDuration = 800`); on Hobby, jobs silently stall. **Overrides:** the plan's n8n
orchestration.

## D-001 · Neon Postgres + raw `pg` + RLS (no ORM, no Supabase)
**Decision:** Neon Postgres accessed via raw `pg` with parameterized SQL; per-request RLS
keyed on `app.current_user` set inside `withUserDb`. **Why:** House DB default (Neon); raw
SQL keeps the data layer transparent for a small schema; RLS is defense-in-depth even though
the app is single-user today (eases any future multi-user move). **Overrides:** the original
plan's Supabase reference; the stale `supabase-schema.sql` was deleted.
