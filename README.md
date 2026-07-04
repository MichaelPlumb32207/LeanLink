# LeanLink NPA FL

A research proof-of-concept that links Florida public voter records to inferred political
**lean** and **turnout / opposition-mobilization** scores, with a single-user dashboard and
CSV/JSON export.

Built for a University of Florida political-science professor: the goal is to study whether
a public voter record can be linked to its online persona using public data + OSINT, so the
**learnings** inform research, courses, and publications. Output is for research and
validation — **not** for contacting, marketing to, or targeting individuals. See
[`docs/CLAUDE.md`](docs/CLAUDE.md) for the full use posture.

> **Status:** working POC pipeline. Upload + turnout/mobilization scoring are production-ready.
> Grok OSINT enrichment runs per-voter via dashboard tests; **full-file batch jobs are disabled**
> until cost/coverage are validated (`LEANLINK_ENABLE_BATCH_INFERENCE`).
> **New (2026-07-03):** generic client-list intake, waterfall settlement (skip already-found
> voters), and prepaid per-tier billing — the tiered product the one-pager sells.
> **New (2026-07-04):** pricing confirmed (incl. $2,500 initiation fee), researcher review
> controls (accept/reopen/re-enroll), waterfall gate with projected next-arm spend, and a
> multi-arm provenance + audit deliverable export. See
> [`docs/PROGRESS.md`](docs/PROGRESS.md) for where to pick up.

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

1. **Upload** a Florida registration extract (`.txt`, 38 tab-delimited fields) — auto-filtered
   to NPA + Active voters. Optionally add a voting-history file (`*_H_*.txt`) for turnout
   scoring. No AI cost on upload.
2. **Analyze** a selected upload — enter a small **row-index subset** (defaults to ~7 curated
   rows/county), pick a test: enrichment, scorecard, Street View exploratory, or **FEC lookup**.
   Four Grok pipeline modes for enrichment/scorecard.
3. **Export** results when present (CSV/JSON). Full-county batch inference is off by default.

## Documentation

- [`leanlink-pitch.html`](leanlink-pitch.html) — **client-facing pitch** (3 pages, print-ready, confirmed pricing)
- [`docs/README.md`](docs/README.md) — **doc index & reading order** (start here for onboarding)
- [`CLAUDE.md`](CLAUDE.md) — architecture & conventions (for Claude Code / new devs)
- [`docs/SETUP.md`](docs/SETUP.md) — provisioning runbook
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — why the stack/design choices were made
- [`docs/USE_CASES.md`](docs/USE_CASES.md) — use cases + test cases
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — build status + continuity / pick-up notes
- [`docs/COST-ESTIMATES.md`](docs/COST-ESTIMATES.md) — Grok $/voter bands
- [`docs/enrichment-pipeline.html`](docs/enrichment-pipeline.html) — enrichment spec (visual)
- [`docs/CLAUDE.md`](docs/CLAUDE.md) — use posture + AI-vendor verification

## License

Proprietary — all rights reserved. See [`LICENSE`](LICENSE).
