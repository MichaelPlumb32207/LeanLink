# LeanLink — Project Notes for Claude Code

## What this is

Began as a proof-of-concept for a **University of Florida political-science professor**
(research question: can a public FL voter record be linked to its **online persona**
using only public data + OSINT?). As of **2026-07-04 (D-027)** it is also a **billed
commercial service** — client-supplied voter lists researched for political lean.

**Two-track use posture (D-027)** — the constraint lives with the *data source*, not
the activity:

- **Track A — FL DOS registration extracts (research only).** The exploration-phase
  test data (Calhoun, Alachua) and any professor work use the FL voter-registration
  extract, which carries use restrictions that exclude commercial/marketing use.
  Everything derived from those uploads stays research/validation-only: **never
  attached to a billing account** (structural — `voter_uploads_fl_extract_unbilled`
  CHECK, migration 012; the upload route never sets `account_id` on that path) and
  **never included in a client deliverable**. PII/gitignore rules for these files
  stand (`CAL_*.txt`, `*_H_*.txt`, `samples/*.txt` never enter git).
- **Track B — client engagements (commercial).** Clients supply **their own lists**
  through generic intake, billed to **their own account**. Enrichment draws only on
  public records (FEC, FL campaign-finance, Sunbiz, open web). Output derives solely
  from the client's rows + public reference data. Isolation from Track A is
  structural, not procedural: per-upload processing (evidence, fusion, household
  index are all upload-scoped), per-client accounts, disjoint identity-hash schemes
  (`hashVoterPii` is voterId-keyed; `hashGenericVoter` is name/address/dob-keyed —
  they can never collide), plus the migration-012 constraint. The client's lawful
  basis for the list they hand us is **the client's responsibility** — capture that
  in engagement terms.

Both tracks share the standing integrity rules (also client-facing promises in
`leanlink-pitch.html`): public data only, no data brokers, race/gender never used as
inputs, conflicting evidence → withheld label, no resale or pooling of results.

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
- **FEC Open API:** direct Schedule A contributor lookup (`lib/fec/contributor-lookup.ts`,
  optional `FEC_API_KEY`; no Grok).

> The original `LeanLink-Plan.html` was drafted before these choices were finalized.
> It has been reconciled to the above (no Supabase, no n8n, OSINT-only enrichment).

## Tiered / prepaid / waterfall product (2026-07-03)

The engine now supports the model the one-pager (`leanlink-one-pager.html`) sells: submit a
voter list, run cheap arms first, bill per successful lean at a rising per-tier rate.

- **Generic intake** (`lib/generic-voter-list.ts`) accepts an arbitrary client list
  (CSV/TSV/paste/JSON, fuzzy headers) and normalizes each row into a `ParsedFlVoterRecord`,
  so **all existing arms consume it unchanged**. No FL voter file, no voter ID. Anchor gate:
  name + ≥1 of county/ZIP/street address. Identity hash for these rows is `hashGenericVoter`
  (name+address+dob+county), separate from the FL `hashVoterPii` (voterId-keyed). Each row
  gets a data-completeness score (`lib/intake/completeness.ts`, thin/moderate/rich) that
  reports which arms can reach it. Entry: `sourceType=generic` in `POST /api/uploads`;
  UI `/dashboard/intake`.
- **Waterfall settlement** (`lib/evidence/settlement.ts`): a voter "settles" once fusion
  yields a non-Undetermined lean at ≥ `LEANLINK_SETTLE_THRESHOLD` (default 60). Settlement
  is set-once at the cheapest contributing tier (0=party, 1=FEC, 2=FL/Sunbiz, 3=OSINT) in
  `persistFusionForVoter`; **later arms exclude settled voters** from their work-sets
  (`claimFecSweepRows`, `runFreePassForUpload`, the batch worker). Migration 008 adds the
  `settled_*` columns. Fusion still runs for unsettled/fall-through voters.
- **Prepaid billing** (`lib/billing/*`, migration 009): `accounts` hold a `prepaid_balance_usd`
  (keyed by a slug `account_id`, optional `fec_committee_id`); `billing_ledger` is the
  append-only signed money log (its `amount_usd` is the rate snapshot, so a later rate edit
  never re-prices a billed batch); `rate_cards` holds a `default` scope plus per-account
  overrides (`resolveRates` merges them, no redeploy). Charge points: **baseline** per accepted
  record at intake, **tier fee** once per settled voter (partial-unique-indexed), **OSINT
  attempt** per paid `/api/enrichment/test` run. `voter_uploads.account_id` links a batch;
  `NULL` = internal/test (unbilled). APIs: `/api/accounts`, `/api/accounts/[id]`,
  `/api/rate-cards`; UI `/dashboard/accounts`.

- **Initiation fee + researcher review (2026-07-04, migration 011, D-026):**
  `billing_ledger` gains an `initiation` kind ($2,500 default via `rate_cards.initiation_usd`,
  once per account ever — billed at account creation or from the Billing console).
  `voter_lean_fusion` gains `review_status` / `research_status`: **Accept**
  (`/api/voters/[id]/review`) freezes a voter's fused lean (fusion early-returns, deliverable
  Status = `accepted`) and excludes them from every arm; **Re-enroll** (same route, or cohort
  via `/api/uploads/[id]/re-enroll`) pushes settled voters back into later arms without
  re-billing. Claim-query predicate everywhere: locked → never claim; re-enrolled → claim even
  if settled; default → unsettled only. The deliverable export lists all contributing arms
  (settled arm first) plus a `?format=audit` per-event provenance export.

**Config knobs (money-sensitive, reversible):** `LEANLINK_SETTLE_THRESHOLD`; all fees via the
`rate_cards` table. OSINT currently bills attempt **and** tier-3 on a hit — set
`osint_attempt_usd=0` for tier-3-only. Provided-party is stored/scored but emits **no** lean
yet (treat as a weak prior the arms confirm/override; never bill for echoing a registration).

**Posture note:** commercial deployment on client-supplied lists is now the operating model
(D-027, 2026-07-04) — see the two-track posture at the top of this doc. FL-extract uploads
remain research-track and structurally unbillable.

## Enrichment policy (both tracks)

**OSINT only.** No Clearbit / FullContact / commercial data-broker enrichment — on the
research track *or* for clients. What started as POC prudence is now a **product
promise**: the pitch's integrity box commits to "public records and open sources only —
no data brokers, ever." If a paid enrichment source is ever reconsidered, it is a
deliberate, counsel-reviewed decision *and* a client-communication event, not a default.

## AI vendor verification (xAI / Grok)

Per global policy, AI endpoints/model-ids/shapes drift — verify before integrating and
keep this table current. Do **not** pin prices/rate-limits here (they rot); pin the URL.

| Capability | Endpoint | Model id | Docs URL | Last verified |
|---|---|---|---|---|
| Lean inference + synthesis | `POST https://api.x.ai/v1/responses` | `grok-4.3` (`XAI_MODEL`) | https://docs.x.ai/docs/models | 2026-06-27 |
| Live web search (grok-full / modular-targeted) | Responses API `tools: [{ type: 'web_search' }]` | n/a | https://docs.x.ai/docs/guides/live-search | 2026-06-27 |
| Live X search | Responses API `tools: [{ type: 'x_search' }]` | n/a | https://docs.x.ai/docs/guides/live-search | 2026-06-27 |
| Vision (Street View) | Responses API `input_image` + text | `grok-4.3` | https://docs.x.ai/docs/models | 2026-06-27 |
| FEC contributor lookup | `GET https://api.open.fec.gov/v1/schedules/schedule_a/` | n/a | https://api.open.fec.gov/developers/ | 2026-06-28 |

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
