# LeanLink — Cost Estimates (living doc)

Rough order-of-magnitude costs for processing NPA voters with Grok live-search enrichment.
Update as we collect more `usage.cost_in_usd_ticks` samples from Test enrichment.

## xAI / Grok (dominant cost)

xAI returns exact per-request cost in `usage.cost_in_usd_ticks` where **1 USD = 10¹⁰ ticks**.

### Calibrated sample (2026-06-27)

| Voter | Scenario | Web searches | Tokens | Cost (USD) |
|-------|----------|--------------|--------|------------|
| Ezra Thomas Childs (row 0) | Thin OSINT, no contact | 4 | 10,996 | **$0.0328** |

Formula: `cost_usd = cost_in_usd_ticks / 10_000_000_000`

### Extrapolation to 10,000 NPAs

Using the single-voter anchor **$0.033/voter**:

| Scenario | $/voter | 10,000 voters |
|----------|---------|---------------|
| **Anchor (Ezra)** | $0.033 | **~$330** |
| Optimistic (fewer searches, thinner) | $0.020 | ~$200 |
| Pessimistic (more searches, matches found) | $0.050 | ~$500 |

**Working estimate: $250–$500 per 10,000 voters** until we have 10+ samples across scenarios
(email on file, common surnames, probable matches, etc.).

## Pricing vs. cost (prepaid billing, D-024)

Client-facing fees live in the editable `rate_cards` table (seeded defaults below), not in
code — tune per account without a redeploy. The waterfall means most voters settle on the
**free** deterministic arms (FEC/FL/Sunbiz), so the paid Grok cost above is incurred only for
records that fall through to OSINT.

| Fee | Default | Cost it must cover |
|---|---|---|
| **Initiation (kickoff), once per account** | **$2,500** | onboarding/engagement setup; ledger kind `initiation` (migration 011) |
| Baseline / accepted record | $0.03 | ingest + free-arm attempts; charged on every record, hit or miss |
| Tier 1 (FEC settle) | $0.15 | free API — margin |
| Tier 2 (FL/Sunbiz settle) | $0.25 | free indexes — margin |
| Tier 3 (OSINT settle) | $0.33 | value premium on a Grok/Apify hit |
| OSINT / attempt | $0.05 | recovers the ~$0.033/voter Grok cost above on **misses** |

The baseline + OSINT-attempt fees exist specifically so a thin-data list (which cascades to
the expensive OSINT arm and rarely settles cheaply) doesn't consume paid attempts for free.
**These defaults were confirmed as the client pricing on 2026-07-04 (D-026).** Both client-facing
HTML docs (`leanlink-pitch.html`, the flagship 3-pager, and `leanlink-one-pager.html`) now quote
these numbers. Adjust per account in the Billing console.

### Market anchors (researched 2026-07-04 — refresh before quoting competitively)

- Setup/onboarding fees: $1k–$5k typical for SMB data-service implementations (NGP VAN);
  i360-class implementations $3k–$30k. → $2,500 is comfortably normal.
- Per-successful-match norms: $0.02–$0.03 commodity append (DataZapp, The Data Group);
  $0.07–$0.20/hit batch skip-tracing; $0.50–$2.00/record investigative-grade (IDI/TLOxp).
  "Charged only on match" is the dominant convention — our free-arm + per-settle framing fits.
- Modeled partisanship (L2, TargetSmart, Catalist, i360): **all quote-only** — no public
  per-score comparable exists. L2 bulk voter-file records reportedly ~$0.025/record direct.
- FEC reality check: itemized federal donors ≈1.4% of adults (2020 cycle; ≈0.5% in 2016), and
  NPAs donate less — so **the baseline fee, not per-lean fees, is the volume revenue driver**
  on a typical list. A $0.01 baseline change moves more revenue than the whole FEC per-lean line.
- OSINT arm: revisit the $0.33 settle fee once real Grok/Apify cost-per-attempt data lands from
  the Alachua runs; investigative-grade comparables suggest headroom to $0.50+.

### What drives variance

- Number of `web_search_calls` per voter (agentic loop)
- Input/output tokens (reasoning + JSON)
- Prompt cache hits (`input_tokens_details.cached_tokens`)
- Match complexity (ambiguous names → more searches)

## Vercel compute (secondary)

Background worker runs on Vercel Pro (`maxDuration = 800s`). Each voter is processed
sequentially inside a worker batch; Grok latency (~15–60s/voter) dominates wall time.

Rough wall-clock for 10,000 voters at ~30s each: **~83 hours** of worker time spread across
many self-chained invocations — well within Pro limits but **not free** (function GB-seconds).

Order of magnitude: **tens of dollars** of Vercel function time vs **hundreds** of xAI for 10k
at current Grok pricing — treat **xAI as the budget line item**.

## Neon Postgres

Negligible for this POC scale (thousands of rows, simple queries).

## Apify (apify-modular only)

Apify bills separately from xAI. POC defaults: ≤5 Google queries + ≤2 page crawls per voter.
Order of magnitude **~$0.01–$0.05/voter** depending on actor pricing and timeouts — refresh
after first live `apify_runs` on a curated row. Grok synthesis cost still applies (typically
lower than `grok-full` because no live search tools).

## FEC Open API (contributor lookup)

**$0** per query (free API key from fec.gov). Dashboard **FEC contributor lookup** runs on the
full test subset with no Grok tokens. Use this to measure Schedule A hit rate before inferring
lean from donations. Set `FEC_API_KEY` in production — `DEMO_KEY` is heavily rate-limited.

Record after validation runs:

| County subset | Rows | Rows with hits | Notes |
|---------------|------|----------------|-------|
| (pending) | 7 | — | Run via Analyze → FEC lookup |

## Recommended testing budget

| Phase | Voters | Est. xAI cost | Notes |
|-------|--------|---------------|-------|
| FEC lookup (7 curated rows) | 7 | **$0** | Run first — isolates donation yield |
| POC scorecard (7 curated rows) | 7 | ~$0.25 | **Preferred** Grok eval path |
| Single-voter enrichment | 1 | ~$0.03 | Pick mode in Analyze UI |
| Pilot batch job | 25 | ~$0.80 | Requires `LEANLINK_ENABLE_BATCH_INFERENCE` |
| Full Calhoun county | 736 | ~$24 | Batch gated — do not run accidentally |
| Alachua county | 40,552 | ~$1,200+ | Batch gated |

**Rule:** keep `LEANLINK_ENABLE_BATCH_INFERENCE` unset until median $/voter and coverage
targets are documented here.

## How to refresh this doc

After each Test enrichment or scorecard, note `usage.cost_usd` and scenario in the Grok table.
After FEC runs, note `rows_with_hits` / `row_count` in the FEC table.
Recompute the 10k band: `median_cost_per_voter × 10,000`.