# LeanLink NPA FL - Tech Stack & Constraints

> **Use context:** Proof-of-concept for a University of Florida political-science
> professor. Goal is linking a public voter record to its online persona, using public
> data + OSINT, so the *learnings* inform his research/courses/publications. Output is
> for research and validation — **not** for contacting, marketing to, or targeting
> individuals. See `docs/CLAUDE.md`.

## Core Stack
- **Frontend**: Next.js 15 (App Router) deployed on Vercel (team Liberty Concierge, **Pro** plan)
- **Database**: Neon Postgres (no external ORMs/helpers — raw SQL or Drizzle if needed)
- **Styling**: Tailwind CSS + shadcn/ui
- **Orchestration**: Self-chaining Vercel function worker + Vercel cron sweeper (no n8n); manual run from the dashboard
- **Auth**: Google Identity only (restricted to meplumb@gmail.com for MVP)
- **Primary AI**: Grok/xAI API for lean inference (see `docs/CLAUDE.md` for verified endpoint/model)
- **Enrichment**: **OSINT only for the POC.** No commercial data-broker vendors (Clearbit/FullContact) — revisit only as a deliberate, counsel-reviewed decision. DIY fuzzy matching in Postgres.
- **Branding**: Default "Matrix" theme with easy toggle to Red (leans-right view) and Blue (leans-left view)

## Non-Goals for MVP
- No multi-user / teams yet
- No outbound contact / texting features
- No billing system

## Nice-to-Haves
- Responsive dashboard with upload progress, results table, filters, and color-mode toggle
- Full audit logging on every enrichment/analysis step
- Export: CSV + JSON
- Legal disclaimer footer (placeholder text to be provided)

Upload this file to Grok Build along with the plan HTML and sample data.
