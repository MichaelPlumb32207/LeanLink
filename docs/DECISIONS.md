# LeanLink — Decision Log (ADR-lite)

Why the project looks the way it does. Newest first. Each entry: the decision, the reason,
and what it overrides. This is the context the plan HTML loses when choices change — keep it
current as design shifts.

---

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
enabled; dashboard **Compare all modes** per voter. **Why:** ~$330/10k at full Grok search —
compare modes on curated rows before any county-scale run.

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
**Decision:** Standard complement = `README.md`, `CLAUDE.md`, `docs/SETUP.md`,
`docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/USE_CASES.md`, `docs/COST-ESTIMATES.md`,
`docs/enrichment-pipeline.html`, `docs/CLAUDE.md`, `LICENSE`. **Why:** Survive context drift
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
