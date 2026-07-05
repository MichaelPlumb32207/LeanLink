# LeanLink — Roadmap

Where the product is going, in priority order. This is the **forward-looking** companion to the
backward-looking docs:

- **What's built** → [`PROGRESS.md`](PROGRESS.md) (status board + continuity notes)
- **Why it looks this way** → [`DECISIONS.md`](DECISIONS.md) (ADR-lite)
- **What it's supposed to do** → [`USE_CASES.md`](USE_CASES.md) (use cases + folded-in test cases)

Keep this current when priorities shift or an item ships (moving a shipped item to PROGRESS.md).
Horizons are intent, not commitments with dates. Last reviewed: **2026-07-05**.

Legend: **Now** = actively in flight · **Next** = committed near-term · **Later** = planned, not
started · **Someday** = conditional / only if a trigger fires.

---

## Now — in flight (July 2026)

| Item | State | Notes |
|---|---|---|
| **Client-doc HTML pass** | Partial | `enrichment-pipeline.html` redrawn to the commercial model; pitch/one-pager pricing current. **Still owed:** `evidence-accumulator-pitch.html` body still frames the research POC (banner only) — full billing/waterfall/two-track redraw + Alachua proof point. |
| **Pitch yield recalibration** | Uncommitted | Worked example moved off the illustrative ~2% Tier-1 to the **measured Alachua rate**; Tiers 2–3 honestly labeled "assumed" until measured. Tighten the "0.5% measured" figure to the true 0.44%. |
| **Retire the FEC API sweep as primary** | In progress | Local bulk index (D-028) is now primary Tier 1; the throttled API sweep stays only as a freshness/spot-check fallback. |

## Next — committed near-term

1. **Measure real Tier 2 / Tier 3 yield.** Run FL/Sunbiz then OSINT on the Alachua remainder to
   replace the pitch's *assumed* Tier 2/3 numbers with measured ones (Tier 1 is now measured at
   0.44%). This is the single biggest input to honest client pricing examples.
2. **Backfill older FEC cycles** (`indiv22`, `indiv20`) into the bulk index to raise Tier 1 hit
   rate — settled voters are skipped automatically on re-match, so it's a safe additive pass.
3. **Manage-uploads UX** — a real delete/**archive** experience (soft `archived_at` on
   `voter_uploads`, hide-without-losing-ledger, ideally bulk), beyond the bare DELETE endpoint.
4. **Name a pasted list** — a "List name" input on generic intake so pastes stop landing as
   `filename = 'pasted-list'` (route already accepts `filename`); improves inventory + deliverable naming.

## Later — planned

1. **Automated test suite** — none exist today. `USE_CASES.md` is the written spec; first targets:
   the two FL parsers, fusion, FEC/FL donation-lean, and `buildResultsSql` (client+server sort/filter parity).
2. **Batch inference re-enable** — document the $/voter + coverage thresholds that must be met,
   then lift `LEANLINK_ENABLE_BATCH_INFERENCE` (gated off since D-020 to prevent accidental county-scale Grok spend).
3. **Sunbiz index performance** — prefix/trigram index on `officer_name_norm`; the free pass is
   slow at county scale (~84 min / 736 voters historically).
4. **Apify-modular evaluation** — run the Alachua curated subset, inspect actors + crawl quality,
   tune URL filtering (prefer FEC/media over login-walled social).
5. **Scorecard Tier-A metrics** — report donation/media/civic hit rates separately from social %.

## Someday — conditional

- **Geo/precinct lean prior** — deferred (D-009); revisit *only* if OSINT coverage proves too thin.
- **Multi-tenant login** — `account_id` is already the seam; single-operator today. Build only when
  a second operator or client self-serve is a real requirement.
- **Additional reference indexes** — new arms plug into the evidence ledger (`lib/evidence/arms.ts`)
  without rewriting the core; add when a source clears the OSINT-only bar and earns its cost.

---

## Open decisions that gate direction (owner calls)

These are reversible-config forks currently parked; each one nudges the roadmap when decided.

| Decision | Current default | The call |
|---|---|---|
| **OSINT charge policy** | Attempt **+** tier-3 on a hit | Keep, or bill tier-3 only (`osint_attempt_usd = 0`). Money-sensitive. |
| **Party-prior treatment** | Inert (provided party emits no lean) | Keep inert, or emit a low-weight tier-0 prior the arms confirm/override (never billed for echoing a registration). |
| **Brand name** | Undecided — parallel LeanLink/OnRecord docs | Pick one; the A/B docs are byte-identical except the name, so it tests the name alone. |
| **Living-doc set alignment** | Project set (D-007) | Optionally reconcile to the global 8-doc standard (this ROADMAP closes part of that gap; `USER_GUIDE.md` is the remaining absentee). |

## Non-goals (explicit — not on any horizon)

- **Outreach, targeting, or contacting individuals.** LeanLink produces lean *intelligence*, never
  a contact/turnout operation.
- **Commercial data brokers.** OSINT / public-records only — now a client-facing product promise, not just POC prudence.
- **Race / gender as model inputs** (D-010) — hard-excluded, permanently.
- **Billing FL-DOS-extract data.** Research-track only and structurally unbillable (migration 012,
  D-027); commercial work runs exclusively on client-supplied lists.

---

## Recently shipped (see PROGRESS.md for detail)

FEC federal bulk index (D-028) · two-track use posture + `fl_extract` unbillable constraint (D-027) ·
confirmed pricing + $2,500 initiation fee + researcher review controls (D-026) · client deliverable
export with provenance/audit · tiered/prepaid/waterfall billing + generic client intake (D-024).
