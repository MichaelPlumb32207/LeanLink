# LeanLink documentation index

Living artifacts for continuity across sessions and onboarding new contributors.
Read in this order when joining the project cold.

| Doc | Purpose | Update when |
|---|---|---|
| [`../README.md`](../README.md) | One-page project overview + quick start | Stack or POC status changes |
| [`CLAUDE.md`](CLAUDE.md) | Research use posture, AI vendor verification | xAI/FEC/Google API shapes change |
| [`SETUP.md`](SETUP.md) | Provisioning runbook (Neon, OAuth, Vercel, env) | New secrets, deploy steps, migrations |
| [`PROGRESS.md`](PROGRESS.md) | **Start here for continuity** — what's built, scorecard findings, open questions | Any shipped feature or eval result |
| [`DECISIONS.md`](DECISIONS.md) | ADR-lite — why the stack and rules look this way | Non-obvious design choices |
| [`enrichment-pipeline.html`](enrichment-pipeline.html) | Visual enrichment/inference spec (modes, guardrails, code map) | Pipeline or mode changes |
| [`evidence-accumulator-pitch.html`](evidence-accumulator-pitch.html) | Pitch deck — multi-arm evidence, identity gates, fusion | Architecture or stakeholder demos |
| [`USE_CASES.md`](USE_CASES.md) | Use cases + manual QA checklist (future automated tests) | New user-facing behavior |
| [`COST-ESTIMATES.md`](COST-ESTIMATES.md) | Grok/Apify $/voter bands from live samples | After scorecard or test enrichment runs |
| [`../leanlink-pitch.html`](../leanlink-pitch.html) | **Client-facing 3-page pitch** — what it is, deliverables, confirmed pricing (print-ready) | Pricing or deliverable changes |

**Also useful:** root [`CLAUDE.md`](../CLAUDE.md) (architecture for coding agents), [`stack-spec.md`](../stack-spec.md) (early stack notes — may lag `DECISIONS.md`).

## POC workflow (dashboard)

1. **Upload** registration extract (+ optional `*_H_*` history) — no AI cost.
2. **Select upload** from inventory.
3. **Evidence accumulator** — upload command bar, voter list + evidence timeline (FEC sweep, fused lean).
4. **Research lab** — row-index subset tests (enrichment, scorecard, Street View, FEC disambiguate).
5. **Export** CSV/JSON when fused lean exists in `lean_results`.

## Tiered / prepaid product (2026-07-03)

- **`/dashboard/intake`** — ingest an arbitrary client voter list (no FL voter file); anchor-gated, completeness-scored.
- **`/dashboard/accounts`** — prepaid billing console: accounts, deposits, per-batch invoices, ledger, editable rate cards, one-time **initiation fee** ($2,500 default, billed at account creation).
- Waterfall settlement skips already-found voters in later arms; billing charges initiation + baseline + per-tier + OSINT-attempt.
- **Researcher review (2026-07-04):** per-voter **Accept** (freeze lean, close research) / **Reopen** / **Re-enroll** (settled voter re-enters later arms, no re-billing); cohort re-enroll + projected next-arm spend in the evidence workspace **Waterfall gate** strip.
- Client deliverable (`/api/export/[id]/deliverable`): original columns + Lean/Confidence/Source (all arms)/Status/Evidence; `?format=audit` = one row per evidence event.
- Dev scripts: `node scripts/apply-migrations.mjs` (migrations), `npx tsx scripts/smoke-billing.ts` (billing verifier). See `DECISIONS.md` D-024/D-026 and `CLAUDE.md` → "Tiered / prepaid / waterfall product".

## Key code paths (enrichment)

| Path | Role |
|---|---|
| `app/dashboard/page.tsx` | Upload UI, analyze subset, results preview |
| `lib/enrichment/grok-pipeline.ts` | Grok OSINT + inference |
| `lib/enrichment/apify-pipeline.ts` | Apify fetch + Grok synthesize |
| `lib/enrichment/query-builder.ts` | Social-first + Tier-A query plan |
| `lib/fec/contributor-lookup.ts` | Direct FEC Schedule A API |
| `lib/evidence/ledger.ts` | Evidence events + fusion → `lean_results` |
| `lib/evidence/arms.ts` | Pluggable arm registry |
| `components/evidence-workspace.tsx` | Dashboard split-pane evidence UI |
| `lib/enrichment/suggested-test-rows.ts` | Curated row indices per county |
| `lib/test-row-indices.ts` | Parse/format dashboard subset input |

## API routes (per-voter / POC)

| Route | Purpose |
|---|---|
| `POST /api/enrichment/test` | Single-row enrichment (mode in body) |
| `POST /api/enrichment/scorecard` | Multi-row metrics (`rowIndices` optional) |
| `POST /api/enrichment/street-view` | Street View vision (`mode: exploratory`) |
| `POST /api/enrichment/fec` | FEC Open API contributor lookup (no Grok) |
| `GET /api/uploads/[id]/evidence-summary` | Upload-level arm stats + fusion counts + waterfall gate |
| `GET/POST /api/uploads/[id]/evidence` | Voter timeline; `sync-fec` backfill |
| `POST /api/voters/[id]/review` | Researcher accept / reopen / re-enroll one voter |
| `POST /api/uploads/[id]/re-enroll` | Cohort re-enroll (confidence/tier filters) or withdraw |
| `GET /api/export/[id]/deliverable` | Client deliverable CSV/JSON; `?format=audit` per-event provenance |
| `GET /api/enrichment/apify-config` | Actor IDs and limits |

Last reviewed: 2026-07-04.