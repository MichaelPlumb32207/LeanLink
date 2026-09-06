# LeanLink — Cost Estimates (living doc)

Rough order-of-magnitude costs for processing NPA voters with Grok live-search enrichment.
Update as we collect more `usage.cost_in_usd_ticks` samples from Test enrichment.

## Exa (retrieval spike — ENH-023 / D-040)

Not yet in the product pipeline. Phase 1 probe reports `costDollars.total` per search when
present. Do **not** pin Exa list prices here (they rot) — see https://exa.ai/pricing and re-check
when wiring `exa-modular`. Expect People + web calls to be **much cheaper than a full Grok
live-search voter** if they replace Grok `web_search` rounds; still cap under OSINT attempt
governance (`--max-usd`).

## xAI / Grok (dominant cost)

xAI returns exact per-request cost in `usage.cost_in_usd_ticks` where **1 USD = 10¹⁰ ticks**.

### Calibrated sample (2026-06-27)

| Canary | Scenario | Web searches | Tokens | Cost (USD) |
|-------|----------|--------------|--------|------------|
| Thin OSINT (row 0) | No contact | 4 | 10,996 | **$0.0328** |

Formula: `cost_usd = cost_in_usd_ticks / 10_000_000_000`

### Extrapolation to 10,000 NPAs

Using the single-voter anchor **$0.033/voter**:

| Scenario | $/voter | 10,000 voters |
|----------|---------|---------------|
| **Anchor (thin OSINT)** | $0.033 | **~$330** |
| Optimistic (fewer searches, thinner) | $0.020 | ~$200 |
| Pessimistic (more searches, matches found) | $0.050 | ~$500 |

**Working estimate: $250–$500 per 10,000 voters** until we have 10+ samples across scenarios
(email on file, common surnames, probable matches, etc.).

## What you spend (vendors)

This file is **your** xAI / Vercel / Neon / Apify bill. The software is MIT (D-045) —
Four Plums does not charge for it. Contact: Michael@Four-Plums.com · https://four-plums.com.
Tips: `bc1qac237n8ekdr370ueyv8795fmm3gerdd5n27ahr`

The waterfall means most voters settle on the **$0-API** deterministic arms (FEC/FL/Sunbiz),
so the Grok cost above is incurred only for records that fall through to OSINT.

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

## FEC federal data (Tier 1)

**Bulk index (primary, D-028):** $0 for the data (public bulk files); ~**2 GB Neon storage
per cycle** (FL-filtered, ~4–5M rows incl. indexes) — the third reference index alongside
FL-contrib (14.2M) and Sunbiz (20.6M). Matching cost: local queries, effectively $0 and
**minutes per county** (vs. days on the API).

**Open API (fallback):** $0 per query (free key), but throttled 4 s/request ≈ 450 rows/hr
max — measured ~94/hr average on Alachua with backoff stalls. Use for freshness/spot checks
only. Set `FEC_API_KEY` in production — `DEMO_KEY` is heavily rate-limited.

Record after validation runs:

| County | Rows | With FEC rows | Identity-confirmed | Tier 1 leans | Notes |
|--------|------|---------------|--------------------|--------------|-------|
| Alachua (bulk index, 2024 cycle) | 40,546 | 4,186 (10.3%) | 247 (0.61%) | **178 (0.44%)** — 132 L / 46 R | 3h12m local match, 2026-07-04; single cycle — older-cycle backfill should raise yield |
| Calhoun (API sweep) | 736 | 27 raw | 3 | 3 | Historic baseline, multi-cycle via API |

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