# LeanLink documentation index

Living artifacts for continuity across sessions and onboarding new contributors.
Read in this order when joining the project cold.

| Doc | Purpose | Update when |
|---|---|---|
| [`../README.md`](../README.md) | One-page project overview + quick start | Stack or POC status changes |
| [`CLAUDE.md`](CLAUDE.md) | Research use posture, AI vendor verification | xAI/FEC/Google API shapes change |
| [`SETUP.md`](SETUP.md) | Provisioning runbook (Neon, OAuth, Vercel, env) | New secrets, deploy steps, migrations |
| [`PROGRESS.md`](PROGRESS.md) | **Start here for continuity** — what's built, scorecard findings, open questions | Any shipped feature or eval result |
| [`ROADMAP.md`](ROADMAP.md) | Forward-looking — Now/Next/Later horizons, open owner decisions, non-goals | Priorities shift or an item ships |
| [`BACKLOG.md`](BACKLOG.md) | Work-item ledger — `DEF-`/`ENH-`/`FEAT-` with root causes, so lessons aren't re-learned | A defect is found **and** when it's fixed |
| [`DECISIONS.md`](DECISIONS.md) | ADR-lite — why the stack and rules look this way | Non-obvious design choices |
| [`plans/`](plans/ENH-019-guided-workbench.md) | Build specs for planned work, written self-contained for hand-off to a builder model (currently: ENH-019 guided workbench) | A plan is authored or revised; when it ships, its outcome folds into PROGRESS/BACKLOG |
| [`enrichment-pipeline.html`](enrichment-pipeline.html) | Visual enrichment/inference spec (modes, guardrails, code map) | Pipeline or mode changes |
| [`evidence-accumulator-pitch.html`](evidence-accumulator-pitch.html) | Pitch deck — multi-arm evidence, identity gates, fusion | Architecture or stakeholder demos |
| [`USE_CASES.md`](USE_CASES.md) | Use-case catalog + embedded happy/edge tests (no separate TEST_PLAN) | New user-facing behavior |
| [`USER_GUIDE.md`](USER_GUIDE.md) | Operator smoke paths (upload, universe, lean conflict, deliverable) | Operator-facing flows change |
| [`COST-ESTIMATES.md`](COST-ESTIMATES.md) | Grok/Apify $/voter bands from live samples | After scorecard or test enrichment runs |
| [`../leanlink-pitch.html`](../leanlink-pitch.html) | **Client-facing 3-page pitch** — what it is, deliverables, confirmed pricing (print-ready) | Pricing or deliverable changes |
| [`../onrecord-pitch.html`](../onrecord-pitch.html) | OnRecord brand variant of the pitch (naming A/B — **generated mirror, never hand-edit**; regenerate: `sed -e 's/LeanLink/OnRecord/g' -e 's/leanlink-pitch/onrecord-pitch/g' leanlink-pitch.html > onrecord-pitch.html`, same pattern for the one-pager) | Whenever the LeanLink source doc changes |

**Also useful:** root [`CLAUDE.md`](../CLAUDE.md) (architecture for coding agents), [`stack-spec.md`](../stack-spec.md) (early stack notes — may lag `DECISIONS.md`).

## POC workflow (dashboard)

1. **Upload** registration extract (+ optional `*_H_*` history) — no AI cost. Choose
   **universe** (NPA research · GOTV · custom) before upload.
2. **Select upload** from inventory (rows show a mini-score: settled · accepted · conflicted;
   universe badge on each row).
3. **Box score** (D-029 / D-036…038) — pinned scoreboard (records in / leans settled /
   conflicted / accepted / still in research) + live progress while an arm runs; per-arm
   **line score** (scoring innings only; click a row → arm detail panel). Sunbiz nests under
   FL contributions (always, including first-run). One polling loop (5s active / 30s idle).
4. **Evidence workspace** — line score + ON BASE (committee CTAs) + arm panels + voter list /
   evidence timeline (no pipeline cards; D-037). Set **Lean conflict rule** (D-044) before
   handing off a client deliverable.
5. **Download deliverable (CSV)** — original columns + Lean/Confidence/Source/Status/Evidence,
   resolved under the upload’s `lean_precedence`.
6. **Research lab** — row-index subset tests (enrichment, scorecard, Street View, FEC disambiguate)
   and research CSV/JSON export from `lean_results`.

## Tiered / prepaid product (2026-07-03)

- **`/dashboard/intake`** — ingest an arbitrary client voter list (no FL voter file); anchor-gated, completeness-scored.
- **`/dashboard/accounts`** — prepaid billing console: accounts, deposits, per-batch invoices, ledger, editable rate cards, one-time **initiation fee** ($2,500 default, billed at account creation).
- Waterfall settlement skips already-found voters in later arms; billing charges initiation + baseline + per-tier + OSINT-attempt.
- **Researcher review (2026-07-04):** per-voter **Accept** (freeze lean, close research) / **Reopen** / **Re-enroll** (settled voter re-enters later arms, no re-billing); cohort re-enroll + projected next-arm spend in the evidence workspace **Waterfall controls** strip (counts live in the pinned box score, D-029).
- Client deliverable (`/api/export/[id]/deliverable`): original columns + Lean/Confidence/Source labels/Status/Evidence (D-042 layers 1–2). Lean conflicts (party vs wallet) use **lean_precedence** (D-044, default wallet). `?format=audit` = full per-event provenance — **internal/operator** by default (D-042 layer 4), not a standard client package.
- Dev scripts: `node scripts/apply-migrations.mjs` (migrations), `npx tsx scripts/smoke-billing.ts` (billing verifier), `npx tsx scripts/ingest-extract.ts` (county-scale FL-extract ingest — dashboard upload caps at Vercel's ~4.5 MB body limit; SETUP §9). See `DECISIONS.md` D-024/D-026 and `CLAUDE.md` → "Tiered / prepaid / waterfall product".

## Key code paths (enrichment)

| Path | Role |
|---|---|
| `app/dashboard/page.tsx` | Upload UI, analyze subset, results preview |
| `lib/enrichment/grok-pipeline.ts` | Grok OSINT + inference |
| `lib/enrichment/apify-pipeline.ts` | Apify fetch + Grok synthesize |
| `lib/exa/*` | Exa retrieval spike (people/web/contents; D-040) — not yet a pipeline mode |
| `lib/ingest/universe.ts` | FL extract universe presets (D-041) |
| `lib/lean-precedence.ts` | Party vs wallet deliverable resolve (D-044) |
| `lib/priority/tiers.ts` | GOTV priority tier pure helpers (Client-1 shape) |
| `lib/enrichment/query-builder.ts` | Social-first + Tier-A query plan |
| `lib/fec/contributor-lookup.ts` | Direct FEC Schedule A API |
| `lib/evidence/ledger.ts` | Evidence events + fusion → `lean_results` |
| `lib/evidence/arms.ts` | Pluggable arm registry |
| `components/evidence-workspace.tsx` | Dashboard split-pane evidence UI + lean conflict select |
| `components/box-score.tsx` + `lib/box-score.ts` | Pinned scoreboard, per-arm line score, live strip (D-029) |
| `components/use-evidence-summary.ts` | The one summary polling loop (5s active / 30s idle) |
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
| `GET /api/export/[id]/deliverable` | Client deliverable CSV/JSON under `lean_precedence` (D-044); `?format=audit` = internal arm audit (D-042) |
| `PATCH /api/uploads/[id]` | Update upload settings (e.g. `lean_precedence`) |
| `GET /api/enrichment/apify-config` | Actor IDs and limits |

Last reviewed: 2026-07-23.