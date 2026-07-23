# LeanLink NPA FL

A research proof-of-concept that links Florida public voter records to inferred political
**lean** and **turnout / opposition-mobilization** scores, with a single-user dashboard and
CSV/JSON export.

Began as research for a University of Florida political-science professor (can a public
voter record be linked to its online persona using public data + OSINT?) and now also runs
as a **billed client service** on client-supplied lists. The use posture is two-track: data
derived from FL DOS voter-registration extracts (the exploration test data and professor
work) stays **research-only** and is structurally unbillable (DB constraint); commercial
engagements run on **client-supplied lists** enriched exclusively from public records. See
[`docs/CLAUDE.md`](docs/CLAUDE.md) for the full posture (D-027).

> **Status:** working POC pipeline. Upload + turnout/mobilization scoring are production-ready.
> Grok OSINT enrichment runs per-voter via dashboard tests; **full-file batch jobs are disabled**
> until cost/coverage are validated (`LEANLINK_ENABLE_BATCH_INFERENCE`).
> **New (2026-07-03):** generic client-list intake, waterfall settlement (skip already-found
> voters), and prepaid per-tier billing — the tiered product the one-pager sells.
> **New (2026-07-04):** pricing confirmed (incl. $2,500 initiation fee), researcher review
> controls (accept/reopen/re-enroll), waterfall gate with projected next-arm spend, and a
> multi-arm provenance + audit deliverable export.
> **New (2026-07-23):** ingest universe presets (NPA research · GOTV · custom); deliverable
> **lean conflict rule** (party vs wallet — default wallet wins, client-overridable). See
> [`docs/PROGRESS.md`](docs/PROGRESS.md) and [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md).

## Stack

Next.js 15 (App Router) · Neon Postgres (raw `pg` + RLS) · NextAuth Google (single user) ·
Grok/xAI (Responses API) · optional Apify fetch · Google Street View vision · Vercel (Pro).
No ORM, no n8n, no external queue.

## Quick start

```bash
cp .env.example .env.local      # then fill in the values — see docs/SETUP.md
npm install
node scripts/apply-migrations.mjs   # applies migrations in order (no psql needed)
npm run dev                     # http://localhost:3000
```

Full provisioning (Neon, Google OAuth, xAI key, Vercel env, Pro-plan requirement) is in
[`docs/SETUP.md`](docs/SETUP.md). It is the authoritative runbook for standing up a fresh
instance from scratch.

## How it works

1. **Upload** a Florida registration extract (`.txt`, 38 tab-delimited fields). Choose
   **universe** at ingest: NPA+Active (research default), GOTV (all parties + ACT/INA), or
   custom. Optionally add a voting-history file (`*_H_*.txt`) for turnout scoring. No AI cost
   on upload. County-scale files: `scripts/ingest-extract.ts` (dashboard body limit ~4.5 MB).
2. **Evidence workspace** — run FEC / FL / Sunbiz arms; box score tracks progress. Set
   **Lean conflict rule** when party and public-evidence lean may disagree (default: wallet).
3. **Export** client deliverable (`/api/export/…/deliverable`) or research lab CSV/JSON.
   Full-county Grok batch inference is off by default.

## Documentation

- [`leanlink-pitch.html`](leanlink-pitch.html) — **client-facing pitch** (3 pages, print-ready, confirmed pricing); [`onrecord-pitch.html`](onrecord-pitch.html) is the OnRecord brand variant for the naming A/B
- [`docs/README.md`](docs/README.md) — **doc index & reading order** (start here for onboarding)
- [`CLAUDE.md`](CLAUDE.md) — architecture & conventions (for Claude Code / new devs)
- [`docs/SETUP.md`](docs/SETUP.md) — provisioning runbook
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — why the stack/design choices were made
- [`docs/USE_CASES.md`](docs/USE_CASES.md) — use cases + test cases
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — operator smoke paths (universe, lean conflict, export)
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — build status + continuity / pick-up notes
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — where the product is going (Now/Next/Later + open decisions)
- [`docs/COST-ESTIMATES.md`](docs/COST-ESTIMATES.md) — Grok $/voter bands
- [`docs/enrichment-pipeline.html`](docs/enrichment-pipeline.html) — enrichment spec (visual)
- [`docs/CLAUDE.md`](docs/CLAUDE.md) — use posture + AI-vendor verification

## License

Proprietary — all rights reserved. See [`LICENSE`](LICENSE).
