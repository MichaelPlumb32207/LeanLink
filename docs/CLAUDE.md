# LeanLink — Project Notes for Claude Code

## What this is

Began as a proof-of-concept for a **University of Florida political-science professor**
(research question: can a public FL voter record be linked to its **online persona**
using only public data + OSINT?). Built by **Four Plums, LLC**
([four-plums.com](https://four-plums.com)). **MIT** — free for any purpose
(D-045, [`LICENSE`](../LICENSE)). Contact: Michael@Four-Plums.com.
Tips: `bc1qac237n8ekdr370ueyv8795fmm3gerdd5n27ahr`.
As of **2026-07-04 (D-027)** it can also ingest **operator-supplied lists**
(isolated from FL-extract data).

**Two-track use posture (D-027)** — the constraint lives with the *data source*, not
the activity:

- **Track A — FL DOS registration extracts (research only).** The exploration-phase
  test data (Calhoun, Alachua) and any professor work use the FL voter-registration
  extract, which carries use restrictions that exclude commercial/marketing use.
  Everything derived from those uploads stays research/validation-only: **never
  attached to an `account_id`** (structural — `voter_uploads_fl_extract_unbilled`
  CHECK, migration 012; the upload route never sets `account_id` on that path).
  PII/gitignore rules for these files stand (`CAL_*.txt`, `*_H_*.txt`,
  `samples/*.txt` never enter git).
- **Track B — operator-supplied lists.** Operators supply **their own lists**
  through generic intake. Enrichment draws only on public records (FEC, FL
  campaign-finance, Sunbiz, open web). Output derives solely from those rows + public
  reference data. Isolation from Track A is structural, not procedural: per-upload
  processing (evidence, fusion, household index are all upload-scoped), disjoint
  identity-hash schemes (`hashVoterPii` is voterId-keyed; `hashGenericVoter` is
  name/address/dob-keyed — they can never collide), plus the migration-012
  constraint. The lawful basis for a list someone supplies is **their
  responsibility**.

Both tracks share the standing integrity rules: public data only, no data brokers,
race/gender never used as inputs, **conflicting public-evidence arms** → fusion
withholds the label, no resale or pooling of results. Separately, **registration party
vs public-evidence** tension is an operator policy (`lean_precedence`, D-044) — default
**wallet** (donations win), not the fusion withhold rule. The software license is
MIT (D-045) — any purpose.

## Stack (as built — supersedes the original plan HTML)

- **Frontend/host:** Next.js 15 (App Router) on Vercel — **Pro** plan (worker `maxDuration`).
- **DB:** Neon Postgres (`us-east-1`), raw `pg` + parameterized SQL. RLS as defense-in-depth.
  Project / endpoint ids live in the operator console / `.env.local`, not in this repo.
  Park/unpark: `docs/SETUP.md`.
- **Background jobs:** self-chaining Vercel function worker + optional Vercel crons.
  No n8n. Worker `maxDuration = 800s` relies on the Pro plan's extended duration.
- **Auth:** NextAuth Google provider, single allowed user (`ALLOWED_USER_EMAIL`).
- **AI judgment:** xAI / Grok via Responses API (`lib/xai/client.ts`, `lib/enrichment/grok-pipeline.ts`).
  Live when `XAI_API_KEY` is set; deterministic mock fallback when missing or on error.
- **AI retrieval (optional):** Exa (`lib/exa/*`, `EXA_API_KEY`) — people index + web/news/contents
  only; never lean judgment. Phase 1 spike (D-040 / ENH-023); `exa-modular` pipeline mode TBD.
- **Apify:** optional fetch layer for `apify-modular` (`lib/apify/*`, `APIFY_API_TOKEN`).
- **Google Maps:** Street View Static for vision tests (`GOOGLE_MAPS_API_KEY`).
- **FEC Open API:** direct Schedule A contributor lookup (`lib/fec/contributor-lookup.ts`,
  optional `FEC_API_KEY`; no Grok).

> Early plan HTML lived outside git (local only). `docs/DECISIONS.md` is the
> authoritative record of stack choices (no Supabase, no n8n, OSINT-only enrichment).

## Waterfall + generic intake (2026-07-03)

Submit a voter list, run cheap arms first, skip voters who already settled.

- **Generic intake** (`lib/generic-voter-list.ts`) accepts an arbitrary list
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
  - **Identity gate before a settle (ENH-012/013, 2026-07-06):** street-address
    corroboration (`lib/reference-data/address-match.ts`) now feeds identity scoring across
    arms. **Sunbiz hard-gates on it** — a name+zip officer match without a corroborated street
    caps at `ambiguous` and can never settle (fixes the Duval 98,650-"confirmed"/0-settle
    collision noise); the layer-2 bridge only bridges address-corroborated officers.
    fl_contrib uses it as a soft bonus + a recency-aware zip penalty. FEC stays zip+city (no
    street field). In-memory, no migration; `SCORER_VERSION` → 3.

- **Researcher review (2026-07-04, migration 011, D-026):**
  `voter_lean_fusion` gains `review_status` / `research_status`: **Accept**
  (`/api/voters/[id]/review`) freezes a voter's fused lean (fusion early-returns, deliverable
  Status = `accepted`) and excludes them from every arm; **Re-enroll** (same route, or cohort
  via `/api/uploads/[id]/re-enroll`) pushes settled voters back into later arms.
  Claim-query predicate everywhere: locked → never claim; re-enrolled → claim even
  if settled; default → unsettled only. The **deliverable** export lists lean + confidence
  + source *labels* (settled arm first among contributing arms). Full `?format=audit` per-event
  provenance is **operator-internal** (D-042).
  **Lean conflict precedence (D-044 / migration 023):** when registration party and
  public-evidence lean disagree, deliverable uses `voter_uploads.lean_precedence`
  (`wallet` default | `registration` | `conflict_undetermined`) via
  `resolveDeliverableLean` — presentation only; accepted freezes fusion.

**Config:** `LEANLINK_SETTLE_THRESHOLD`. **Provided-party (T0)** is stored on intake and is
**not** auto-written as a fusion evidence event / settle arm (box score: pre-game context).
The deliverable may still surface a registration prior or resolve party-vs-wallet
tension via `lean_precedence` (D-044, default wallet) — never rewrites fusion.

**Posture note:** Track B (operator-supplied lists) is available (D-027, 2026-07-04).
FL-extract uploads remain research-track (`account_id` stays NULL). License is MIT (D-045).

## Enrichment policy (both tracks)

**OSINT only.** No Clearbit / FullContact / commercial data-broker enrichment — on the
research track *or* on operator-supplied lists. Public records and open sources only —
no data brokers. If a paid enrichment source is ever reconsidered, it is a deliberate,
counsel-reviewed decision, not a default.

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
| Exa people / web search (retrieval only) | `POST https://api.exa.ai/search` (`x-api-key` / Bearer) | n/a | https://exa.ai/docs/reference/search | 2026-07-22 |
| Exa page contents | `POST https://api.exa.ai/contents` | n/a | https://exa.ai/docs/reference/contents-api-guide | 2026-07-22 |

**Exa conventions we depend on:** `category: "people"` for the professional-profile index (no
`includeDomains` / date filters on people — 400 if sent); structured person fields under
`results[].entities[]` (`type: "person"`, `properties.name` / `location` / `workHistory`);
`costDollars.total` when present; judgment stays Grok (D-040).

## Data-source verification (layouts drift too — Resilience norm, 2026-07-06)

Same convention as the AI table, for the **data** sources: pin the conventions we depend on
and the canonical URL, never the volatile numbers. **Re-verify when:** loading a new
cycle/quarter, a parser reject-rate spike, or any loader error — and record the date here.

| Source | Conventions we depend on | Docs URL | Last verified |
|---|---|---|---|
| FL DOS voter-registration extract | 38 tab-delimited fields, **no header**; party = field 24, status = field 29 (1-based); trailing columns often empty — **never `trim()` a line**; `*_H_*` history files: 5 fields | https://dos.fl.gov/elections/data-statistics/voter-registration-statistics/voter-extract-disk-request/ | 2026-06-27 |
| FEC bulk indiv + committee master | `indiv{yy}.zip`/`cm{yy}.zip`; 21 pipe-delimited cols, no header; SUB_ID unique; dates MMDDYYYY; committee party from cm master | https://www.fec.gov/campaign-finance-data/contributions-individuals-file-description/ | 2026-07-04 |
| FL DOS campaign-finance contributions | TSV export; contributor name/address/city/zip/occupation, committee name embeds party as "(REP)/(DEM)" suffixes | https://dos.elections.myflorida.com/campaign-finance/contributions/ | 2026-06-29 (initial load) |
| Sunbiz corporate officers (COR quarterly) | Fixed-width COR files, sharded quarterly (`{yyyy}q{n}-cor{i}` snapshots); officer name/title/address per row | https://dos.fl.gov/sunbiz/other-services/data-downloads/ | 2026-06-29 (initial load) |

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
