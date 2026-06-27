# LeanLink NPA FL - Tech Stack & Constraints

## Core Stack
- **Frontend**: Next.js 15 (App Router) deployed on Vercel
- **Database**: Neon Postgres (no external ORMs/helpers — raw SQL or Drizzle if needed)
- **Styling**: Tailwind CSS + shadcn/ui
- **Orchestration**: Manual execution from HTML or web app dashboard
- **Auth**: Google Identity only (restricted to meplumb@gmail.com for MVP)
- **Primary AI**: Grok/xAI API for lean inference
- **Enrichment**: OSINT sources first / if progress is elusive, explore Clearbit + FullContact (with API key placeholders); DIY fuzzy fallback in Postgres
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
