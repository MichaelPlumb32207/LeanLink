# LeanLink — Decision Log (ADR-lite)

Why the project looks the way it does. Newest first. Each entry: the decision, the reason,
and what it overrides. This is the context the plan HTML loses when choices change — keep it
current as design shifts.

---

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
**Decision:** v1 enrichment = xAI Responses API with `web_search` tool (Grok live search).
Evaluate via `POST /api/enrichment/test` + dashboard **Test enrichment** before building
modular fetchers (S1–S5). **Why:** Fastest path to watch what Grok searches and returns;
pivot to modular if auditability/cost/latency require it. **Spec:** `docs/enrichment-pipeline.html`.

## D-007 · Living-docs artifact set
**Decision:** Standard complement = `README.md`, `CLAUDE.md`, `docs/SETUP.md`,
`docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/USE_CASES.md`, `docs/CLAUDE.md`, `LICENSE`.
**Why:** Survive context drift between sessions and across teammates (Michael, Claude,
Grok Build); make the project handover-ready. **Deferred:** CONTRIBUTING/SECURITY/CHANGELOG —
overkill for a single-user POC.

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
