# LeanLink NPA FL

A research proof-of-concept that links Florida public voter records to inferred political
**lean** and **turnout / opposition-mobilization** scores, with a single-user dashboard and
CSV/JSON export.

Built for a University of Florida political-science professor: the goal is to study whether
a public voter record can be linked to its online persona using public data + OSINT, so the
**learnings** inform research, courses, and publications. Output is for research and
validation — **not** for contacting, marketing to, or targeting individuals. See
[`docs/CLAUDE.md`](docs/CLAUDE.md) for the full use posture.

> **Status:** scaffold + working pipeline. The lean inference is currently a
> **history-aware mock** — turnout/mobilization scoring is real, but lean direction and
> confidence are stubbed pending the Grok/xAI integration. See
> [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Stack

Next.js 15 (App Router) · Neon Postgres (raw `pg` + RLS) · NextAuth Google (single user) ·
Grok/xAI for inference (pending) · Vercel (Pro) with cron-driven background jobs. No ORM,
no n8n, no external queue.

## Quick start

```bash
cp .env.example .env.local      # then fill in the values — see docs/SETUP.md
psql "$DATABASE_URL" -f migrations/001_initial_schema.sql
psql "$DATABASE_URL" -f migrations/002_history_columns.sql
npm install
npm run dev                     # http://localhost:3000
```

Full provisioning (Neon, Google OAuth, xAI key, Vercel env, Pro-plan requirement) is in
[`docs/SETUP.md`](docs/SETUP.md). It is the authoritative runbook for standing up a fresh
instance from scratch.

## How it works

1. **Upload** a Florida registration extract (`.txt`, 38 tab-delimited fields) — auto-filtered
   to NPA + Active voters. Optionally add a voting-history file (`*_H_*.txt`) for turnout
   scoring.
2. **Run** the analysis job. A self-chaining Vercel worker processes rows in batches; a cron
   sweeper re-triggers anything that stalls.
3. **Review & export** results (lean, confidence, turnout propensity, primary engagement,
   opposition-mobilization score) in the dashboard or as CSV/JSON.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — architecture & conventions (for Claude Code / new devs)
- [`docs/SETUP.md`](docs/SETUP.md) — provisioning runbook
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — why the stack/design choices were made
- [`docs/USE_CASES.md`](docs/USE_CASES.md) — use cases + test cases
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — build status (what's real vs. stubbed)
- [`docs/CLAUDE.md`](docs/CLAUDE.md) — use posture + AI-vendor verification

## License

Proprietary — all rights reserved. See [`LICENSE`](LICENSE).
