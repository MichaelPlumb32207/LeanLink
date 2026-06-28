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
| [`USE_CASES.md`](USE_CASES.md) | Use cases + manual QA checklist (future automated tests) | New user-facing behavior |
| [`COST-ESTIMATES.md`](COST-ESTIMATES.md) | Grok/Apify $/voter bands from live samples | After scorecard or test enrichment runs |

**Also useful:** root [`CLAUDE.md`](../CLAUDE.md) (architecture for coding agents), [`stack-spec.md`](../stack-spec.md) (early stack notes — may lag `DECISIONS.md`).

## POC workflow (dashboard)

1. **Upload** registration extract (+ optional `*_H_*` history) — no AI cost.
2. **Select upload** from inventory.
3. **Analyze** — enter a small **row-index subset** (defaults to ~7 county-curated rows), pick a **test** (enrichment, scorecard, Street View exploratory, or FEC lookup), run.
4. **Export** CSV/JSON when batch results exist (batch inference is off by default).

## Key code paths (enrichment)

| Path | Role |
|---|---|
| `app/dashboard/page.tsx` | Upload UI, analyze subset, results preview |
| `lib/enrichment/grok-pipeline.ts` | Grok OSINT + inference |
| `lib/enrichment/apify-pipeline.ts` | Apify fetch + Grok synthesize |
| `lib/enrichment/query-builder.ts` | Social-first + Tier-A query plan |
| `lib/fec/contributor-lookup.ts` | Direct FEC Schedule A API |
| `lib/enrichment/suggested-test-rows.ts` | Curated row indices per county |
| `lib/test-row-indices.ts` | Parse/format dashboard subset input |

## API routes (per-voter / POC)

| Route | Purpose |
|---|---|
| `POST /api/enrichment/test` | Single-row enrichment (mode in body) |
| `POST /api/enrichment/scorecard` | Multi-row metrics (`rowIndices` optional) |
| `POST /api/enrichment/street-view` | Street View vision (`mode: exploratory`) |
| `POST /api/enrichment/fec` | FEC Open API contributor lookup (no Grok) |
| `GET /api/enrichment/apify-config` | Actor IDs and limits |

Last reviewed: 2026-06-28.