# LeanLink — Roadmap

Where the product is going, in priority order. This is the **forward-looking** companion to the
backward-looking docs:

- **What's built** → [`PROGRESS.md`](PROGRESS.md) (status board + continuity notes)
- **Why it looks this way** → [`DECISIONS.md`](DECISIONS.md) (ADR-lite)
- **What it's supposed to do** → [`USE_CASES.md`](USE_CASES.md) (use cases + folded-in test cases)

Keep this current when priorities shift or an item ships (moving a shipped item to PROGRESS.md).
Horizons are intent, not commitments with dates. Last reviewed: **2026-07-06**.

Legend: **Now** = actively in flight · **Next** = committed near-term · **Later** = planned, not
started · **Someday** = conditional / only if a trigger fires.

---

## Now — in flight (July 2026)

| Item | State | Notes |
|---|---|---|
| **Client-doc HTML pass** | Partial | Pitch + one-pager recalibrated to **measured** numbers 2026-07-06 (T1 band 0.32–0.51%, T2 evidence-rich framing, county-in-2h turnaround, receipt-level audit) and OnRecord mirrors regenerated. **Still owed:** `evidence-accumulator-pitch.html` body still frames the research POC (banner only) — full billing/waterfall/two-track redraw + Duval/Alachua proof points. |
| **Pitch yield recalibration** | ✅ Done 2026-07-07 | Worked example uses the measured T1 band (0.32–0.51%, +16% from committee classification), measured Tier 2 (evidence-rich, settle-light), and — new 2026-07-07 — **Tier 3 reframed from "assumed ~1,600 leans" to measured enrichment** (rare direct leans; priced as research). Headline moved from "≈1,700 leans / $2.50 per lean" to "≈140 defensible partisan leans + full intelligence on all 25,000 records / ≈$0.13 per record" — the honest list-intelligence value prop. OnRecord mirror regenerated. |
| **Retire the FEC API sweep as primary** | In progress | Local bulk index (D-028) is now primary Tier 1; the throttled API sweep stays only as a freshness/spot-check fallback. |

## Next — committed near-term

1. **Measure real Tier 3 yield** (Tier 2 ✅ measured 2026-07-06 on Duval: **~0.005% settles**
   — 8 of 146,129 — plus heavy evidence enrichment; identity gating dominates FL person-name
   matches). **Harness ready (ENH-015, 2026-07-06):** `scripts/run-osint-cohort.ts` runs a
   hard-dollar-capped Grok pass over a curated ~100-voter eligible cohort (`--dry-run` previews
   cost with zero spend). **Measured 2026-07-07:** on NPAs → 0 leans; on a *positive control* of
   known donors + party-registered voters → only **1/10** leaned. Root cause (ENH-016): OSINT was
   wastefully re-searching FEC/finance DBs that Tiers 1–2 already own — now re-scoped to public
   political expression. **Open lever (ENH-017):** public follow-graph (Bluesky/X) — measure
   coverage before investing. Pitch's Tier-3 example should move from "assumed" to "measured
   near-zero settle; persona-linkage enrichment only" once the follow-graph probe resolves. **Sunbiz Tier 2 re-measurement** is now the near-term step: the address
   gate (ENH-012) shipped 2026-07-06 — re-run the Duval Sunbiz arm and record whether the
   tightened gate recovers any address-backed settles vs the 98,650-noise/0-settle baseline.
   Pitch worked example must move Tier 2 from "assumed settles" to "enrichment arm".
2. **Box score Phase B — `arm_runs` live progress (D-029, migration 014).** Per-arm run rows
   (status/processed/heartbeat/rate) written by every runner **including the CLI scripts**, a
   generalized current-inning panel with rate/ETA/stalled detection, free-pass chunking + a
   >5,000-row UI guard, and a live-run dot on the uploads list. Apply 014 before pushing.
3. **Backfill older FEC cycles** (`indiv22`, `indiv20`) into the bulk index to raise Tier 1 hit
   rate — settled voters are skipped automatically on re-match, so it's a safe additive pass.
   **Code ready (ENH-014, 2026-07-06):** matching now spans all completed `fec_indiv` snapshots
   at once, so each cycle loads under its own label and joins the match set automatically.
   Remaining: the operator download + ~30-min-per-cycle load (SETUP §8a), then a bracketed
   re-match (`repass-diff.ts`) to measure the lift.
3. **Manage-uploads UX** — a real delete/**archive** experience (soft `archived_at` on
   `voter_uploads`, hide-without-losing-ledger, ideally bulk), beyond the bare DELETE endpoint.
4. **Name a pasted list** — a "List name" input on generic intake so pastes stop landing as
   `filename = 'pasted-list'` (route already accepts `filename`); improves inventory + deliverable naming.
5. **Guided evidence workbench (ENH-019)** — **Phase 1 + the D-036 scoreboard cleanup shipped
   2026-07-08** (reviewed by Opus): clickable line-score innings expand into per-arm detail panels;
   the box score enforces single-source discipline (funnel removed, vocab unified, Conflicted/
   Accepted non-zero-only). **Phase 2's guide rail was built and ditched on the owner's screen-read
   (D-037)** — it duplicated the line score + ON BASE strip and its linear metaphor mis-signalled;
   the pipeline cards it would have replaced are retired anyway (actions live in the arm panels).
   **Still to come — Phase 3:** Review stage (wire the conflict filter, move the waterfall controls
   in) + Deliver stage recap + mobile/theme/keyboard polish. Full build spec:
   [`plans/ENH-019-guided-workbench.md`](plans/ENH-019-guided-workbench.md) (Phase 2 section
   superseded by D-037). Presentation-only: no migrations, no new routes, single polling loop (D-029).
   Feeds the end-to-end client walkthrough.

## Resilience — recognize · adapt · deliver (adopted 2026-07-06, owner)

Client files, data sources, and protocols change; the Duval week proved recovery is cheap
(idempotent re-passes, arm isolation) but detection was human-only. This horizon moves
detection into the system and makes adaptation cheaper still. Ledger entries: ENH-006…011.

**Recognize**
1. **Funnel baselines + anomaly flags** (ENH-006, P1) — arm_runs already records the funnel;
   compare each run to prior-run bands and flag deviations in the box score ("hit rate 0.9%
   vs typical 10% — source drift?"). A zero-settle pass should flag itself in the first
   thousand voters.
2. **Golden-voter canaries** (ENH-007, P1) — PII-safe known-answer fixtures through
   parse → match → fuse, asserting funnel outcomes (à la `smoke-billing.ts`); sharpens the
   "automated tests" item into a drift detector. DEF-005 would have failed a golden on day one.
3. **Format sentinels at intake seams** (ENH-009, P2) — schema fingerprints on client files
   and reference loads (column counts, field-shape sanity, reject-rate thresholds, layout
   deltas vs prior cycle) so upstream protocol changes fail loudly at the door.
4. **Data-source verification table** (✅ done 2026-07-06) — the AI-vendor last-verified
   convention extended to FEC bulk / FL DOS extract / FL contributions / Sunbiz COR layouts
   (docs/CLAUDE.md).

**Adapt**
5. **Unified, data-driven pattern registry** (ENH-008, P1) — one source for lean patterns
   (donation-lean + committee-lean forked once already: DEF-005/006), moved beside researcher
   labels so tuning is an edit, not a deploy.
6. **Scorer version stamps on evidence** (part of ENH-008) — `scorer_v` in payloads so logic
   changes can target re-passes at exactly the stale events.
7. **Re-pass as a product operation** (ENH-010, ✅ done 2026-07-06) — supersede (DEF-009) +
   before/after diff (`lib/evidence/repass-diff.ts` + `scripts/repass-diff.ts`: `snapshot`
   before a re-pass, `report` after → settles gained/lost, leans gained/lost/flipped,
   confidence movement, why). UI button folds into ENH-011's deliverable-delta attachment.

**Deliver**
8. **Deliverable versioning + delta reports** (ENH-011, P2) — when data/logic improves after
   delivery, ship the diff with evidence; turns "results changed" into a trust feature and a
   billable refresh.
9. **Status-snapshot export** (part of ENH-011) — one-click client-ready paragraph from the
   box score.

**Norm (definition of done for every new arm):** funnel metrics in arm_runs + a golden
fixture + a data-source verification entry, before the arm ships.

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
  **Parked research (ENH-027, 2026-07-27):** OpenPlanter review — do not integrate that product;
  when next opening this item, start from
  [`plans/ENH-027-openplanter-source-catalog.md`](plans/ENH-027-openplanter-source-catalog.md)
  (source-card docs → ProPublica 990 measure-first probe → arm only if yield clears).

---

## Open decisions that gate direction (owner calls)

These are reversible-config forks currently parked; each one nudges the roadmap when decided.

| Decision | Current default | The call |
|---|---|---|
| **OSINT charge policy** | Attempt **+** tier-3 on a hit | Keep, or bill tier-3 only (`osint_attempt_usd = 0`). Money-sensitive. |
| **Party-prior as fusion settle arm** | Still inert in fusion (no auto `party_prior` evidence event) | Optional later: low-weight tier-0 fusion prior arms confirm/override (never billed for echoing). **Deliverable side closed by D-044** (party vs wallet is client-configurable; default wallet). |
| **Brand name** | Undecided — parallel LeanLink/OnRecord docs | Pick one; the A/B docs are byte-identical except the name, so it tests the name alone. |
| **Living-doc set alignment** | Project set + `BACKLOG.md` | `USE_CASES.md` is the catalog (no separate `TEST_PLAN`/`USE_CASE_CATALOG`); `USER_GUIDE.md` added 2026-07-23 for operator smoke paths. |

## Non-goals (explicit — not on any horizon)

- **Outreach, targeting, or contacting individuals.** LeanLink produces lean *intelligence*, never
  a contact/turnout operation.
- **Commercial data brokers.** OSINT / public-records only — now a client-facing product promise, not just POC prudence.
- **Race / gender as model inputs** (D-010) — hard-excluded, permanently.
- **Billing FL-DOS-extract data.** Research-track only and structurally unbillable (migration 012,
  D-027); commercial work runs exclusively on client-supplied lists.

---

## Recently shipped (see PROGRESS.md for detail)

**2026-07-23 — Lean conflict precedence (D-044 / ENH-026):** deliverable resolves
registration-vs-wallet tension via `lean_precedence` (default **wallet**); UI select + export.

**2026-07-23 — Ingest universe (D-041 / ENH-024):** NPA research vs GOTV (ACT+INA, all
parties) vs custom — stored on `voter_uploads.ingest_universe`, dashboard + CLI. Calhoun Jul
2026 GOTV+history loaded. Next: lean-corpus beyond party chairs, then Alachua GOTV retest. ·

**2026-07-22 — Exa retrieval spike (D-040 / ENH-023 Phase 1):** modular “retrieve then judge”
direction for OSINT — Exa people/web for fetch, Grok for judgment + x_search. Phase 0 showed
People helps public-footprint identity only; thin NPAs still empty. Code: `lib/exa/*`, offline
scorer smoke, read-only probe CLI. Phase 2 `exa-modular` scorecard-gated. ·

**2026-07-07 — Tier-3 verdict + the committee yield lever (D-033/D-034):** measured Tier-3 OSINT
as *enrichment, not settle* (0 leans on NPAs; 1/10 on a known-signal control) → OSINT re-scoped to
public expression (ENH-016), Bluesky follow-graph shelled after a coverage≈0 probe (ENH-017),
pitch reframed. The yield lever is **Grok classifying public committees, not voters** (ENH-018):
FEC scorer honors committee labels + a Grok committee classifier (bipartisan→Undetermined) +
committee-manager v2 (review/override agent labels + "Re-fuse now"; ENH-018-UI) → **Duval 478→556
settled, 0.32%→0.38% for ~$0.05**. Plus: re-pass diff report (ENH-010), FEC multi-snapshot
matching for indiv22/20 backfill (ENH-014), hard-capped Tier-3 OSINT harness (ENH-015), evidence
filter debounce/decouple/latest-wins + live totals (DEF-011). ·

Address-corroboration identity gate (ENH-012/013): Sunbiz officer matches hard-gated on
street address (name+zip collisions demote to `ambiguous`, never settle) + per-person hit
clustering on the layer-2 bridge; fl_contrib street-corroboration bonus + recency-aware zip
penalty; one shared `lib/reference-data/address-match.ts`; `SCORER_VERSION` → 3 ·
Resilience Wave 1: pattern registry (019) + golden voters + funnel anomaly flags (ENH-006/7/8) ·
Box-score dashboard Phase A: pinned scoreboard + per-arm line score + unified polling (D-029) ·
FEC federal bulk index (D-028) · two-track use posture + `fl_extract` unbillable constraint (D-027) ·
confirmed pricing + $2,500 initiation fee + researcher review controls (D-026) · client deliverable
export with provenance/audit · tiered/prepaid/waterfall billing + generic client intake (D-024).
