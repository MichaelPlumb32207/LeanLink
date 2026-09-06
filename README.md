# LeanLink

A tool that links **Florida public voter records** (and operator-supplied lists)
to inferred political **lean**, **turnout**, and **mobilization** scores, with a
single-user dashboard and CSV/JSON export.

Built by **[Four Plums, LLC](https://four-plums.com)** (Jacksonville).  
Questions or collabs: **[Michael@Four-Plums.com](mailto:Michael@Four-Plums.com)**

## License

**[MIT](LICENSE)** — free and open source. Use it for any purpose, including
commercial and political work. Keep the copyright notice.

There is **no live hosted demo.** The Vercel app is sunset; run it locally
(`docs/SETUP.md`). If you find this on GitHub and want help standing it up,
email [Michael@Four-Plums.com](mailto:Michael@Four-Plums.com).

There is **no telemetry and no phone-home**. We will not know you cloned it
unless you fork in public, show up in GitHub’s 14-day traffic stats, or write us.

## What this is / is not

Began as a University of Florida political-science research question: can a public
voter record be linked to its **online persona** using only public data + OSINT?

- **Public records and open sources only.** No data brokers.
- Built for **research and validation**, not as a contact or turnout operation
  (the software does not send mail, texts, or calls).
- Race and gender are never used as inputs. Conflicting public-evidence arms
  withhold the lean rather than invent one.
- Two data tracks (D-027): Florida DOS registration extracts stay isolated
  (research-track; never attach an `account_id`); generic lists you supply
  yourself use a different identity hash and cannot collide with extract rows.
- Single-user by construction (Google sign-in, one `ALLOWED_USER_EMAIL`).

Your own Grok / Vercel / Neon spend is yours — see
[`docs/COST-ESTIMATES.md`](docs/COST-ESTIMATES.md).

## Stack

Next.js 15 (App Router) · Neon Postgres (raw `pg` + RLS) · NextAuth Google
(single user) · Grok/xAI (Responses API) · optional Apify fetch · Google Street
View vision · Vercel (**Pro** — the worker’s `maxDuration = 800` exceeds Hobby).
No ORM, no n8n, no external queue.

## Quick start

```bash
cp .env.example .env.local      # fill in your own keys — see docs/SETUP.md
npm install
node scripts/apply-migrations.mjs   # applies migrations in order (no psql needed)
npm run dev                     # http://localhost:3000
```

Provisioning (Neon, Google OAuth, xAI, Vercel) is in
[`docs/SETUP.md`](docs/SETUP.md).

## How it works

1. **Upload** a Florida registration extract (`.txt`, 38 tab-delimited fields).
   Choose **universe** at ingest: NPA+Active (research default), GOTV (all parties
   + ACT/INA), or custom. Optionally add a voting-history file (`*_H_*.txt`) for
   turnout scoring. No AI cost on upload. County-scale files:
   `scripts/ingest-extract.ts` (dashboard body limit ~4.5 MB).
2. **Evidence workspace** — run FEC / FL / Sunbiz arms; box score tracks progress.
   Set **Lean conflict rule** when party and public-evidence lean may disagree
   (default: wallet).
3. **Export** a deliverable (`/api/export/…/deliverable`) or research lab CSV/JSON.
   Full-file Grok batch inference is off by default (`LEANLINK_ENABLE_BATCH_INFERENCE`).

## Documentation

- [`docs/README.md`](docs/README.md) — doc index & reading order
- [`CLAUDE.md`](CLAUDE.md) — architecture & conventions (for coding agents)
- [`docs/SETUP.md`](docs/SETUP.md) — provisioning runbook
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — why the stack/design choices were made
- [`docs/USE_CASES.md`](docs/USE_CASES.md) — use cases + test cases
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — operator smoke paths
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — build status
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — Now / Next / Later
- [`docs/COST-ESTIMATES.md`](docs/COST-ESTIMATES.md) — what **you** spend on Grok/Vercel to run it
- [`docs/CLAUDE.md`](docs/CLAUDE.md) — use posture + AI-vendor verification

## Four Plums

LeanLink is a [Four Plums](https://four-plums.com) project.
Four Plums, LLC · Jacksonville · [Michael@Four-Plums.com](mailto:Michael@Four-Plums.com)

Donations/tips appreciated: `bc1qac237n8ekdr370ueyv8795fmm3gerdd5n27ahr`
