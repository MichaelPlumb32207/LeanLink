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

## Recommended testing budget

| Phase | Voters | Est. xAI cost |
|-------|--------|---------------|
| Scenario matrix (7 suggested rows) | 7 | ~$0.25 |
| Pilot batch job | 25 | ~$0.80 |
| Full Calhoun county | 736 | ~$24 |
| Hypothetical 10k county | 10,000 | ~$330 |

## How to refresh this doc

After each Test enrichment, note `usage.cost_usd` and scenario in the table above.
Recompute the 10k band: `median_cost_per_voter × 10,000`.