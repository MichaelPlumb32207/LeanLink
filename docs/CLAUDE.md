# LeanLink — Project Notes for Claude Code

## What this is

Proof-of-concept built for a **University of Florida political-science professor**.
The research question: as voters get harder to reach over US Mail, landline, and
email, can a public FL voter record be linked to the corresponding **online persona**
using only public data + OSINT?

**Use context matters and constrains the design:**
- Output goes to the professor for **research, validation, and teaching** — the
  *learnings* feed his courses and publications.
- It is **not** used to contact, market to, target, or otherwise act on the
  individuals. No outbound. No resale of person-level data.
- Input is FL public voter record (NPA, active). Enrichment is **OSINT only** for the
  POC — no commercial data-broker vendors (see below).

This framing is what keeps the work inside an educational-research use posture. If the
use ever shifts toward contacting or targeting individuals, the legal/compliance
picture changes materially and must be revisited with counsel first.

## Stack (as built — supersedes the original plan HTML)

- **Frontend/host:** Next.js 15 (App Router) on Vercel — team Liberty Concierge, **Pro** plan.
- **DB:** Neon Postgres (`us-east-1`), raw `pg` + parameterized SQL. RLS as defense-in-depth.
- **Background jobs:** self-chaining Vercel function worker + Vercel cron sweeper.
  No n8n. Worker `maxDuration = 800s` relies on the Pro plan's extended duration.
- **Auth:** NextAuth Google provider, single allowed user (`ALLOWED_USER_EMAIL`).
- **AI:** xAI / Grok via Responses API (`lib/xai/client.ts`, `lib/enrichment/grok-pipeline.ts`).
  Live when `XAI_API_KEY` is set; deterministic mock fallback when missing or on error.
- **Apify:** optional fetch layer for `apify-modular` (`lib/apify/*`, `APIFY_API_TOKEN`).
- **Google Maps:** Street View Static for vision tests (`GOOGLE_MAPS_API_KEY`).

> The original `LeanLink-Plan.html` was drafted before these choices were finalized.
> It has been reconciled to the above (no Supabase, no n8n, OSINT-only enrichment).

## Enrichment policy (POC)

**OSINT only.** No Clearbit / FullContact / commercial data-broker enrichment in the
POC. (Those vendors are also moving targets — Clearbit was absorbed into HubSpot,
FullContact has changed access — so they are not worth wiring up now.) If a paid
enrichment source is ever reconsidered, it is a deliberate, counsel-reviewed decision,
not a default.

## AI vendor verification (xAI / Grok)

Per global policy, AI endpoints/model-ids/shapes drift — verify before integrating and
keep this table current. Do **not** pin prices/rate-limits here (they rot); pin the URL.

| Capability | Endpoint | Model id | Docs URL | Last verified |
|---|---|---|---|---|
| Lean inference + synthesis | `POST https://api.x.ai/v1/responses` | `grok-4.3` (`XAI_MODEL`) | https://docs.x.ai/docs/models | 2026-06-27 |
| Live web search (grok-full / modular-targeted) | Responses API `tools: [{ type: 'web_search' }]` | n/a | https://docs.x.ai/docs/guides/live-search | 2026-06-27 |
| Live X search | Responses API `tools: [{ type: 'x_search' }]` | n/a | https://docs.x.ai/docs/guides/live-search | 2026-06-27 |
| Vision (Street View) | Responses API `input_image` + text | `grok-4.3` | https://docs.x.ai/docs/models | 2026-06-27 |

Conventions we depend on (these don't change as often and trip you up when they do):
- Base URL `https://api.x.ai/v1`; auth via `Authorization: Bearer $XAI_API_KEY`.
- Request body is OpenAI-shaped: `{ model, messages, ... }`; output cap is
  `max_completion_tokens`.
- Grok models have **no realtime knowledge** unless server-side search is enabled via
  `search_parameters`.
- The canonical live model list is the console
  (https://console.x.ai/team/default/models) — confirm the exact `grok-4.3` id string
  there before shipping the first real call; the sample-output schema's old
  `grok-4-heavy` reference is stale.

**Re-verify when:** writing the first real Grok call, adding a new xAI capability
(search, structured output, vision), or any 4xx / "deprecated" / unparseable response.
