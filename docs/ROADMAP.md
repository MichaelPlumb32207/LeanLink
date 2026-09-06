# LeanLink — Roadmap

Where the **software** is going. Companion docs:

- **What's built** → [`PROGRESS.md`](PROGRESS.md) (scoreboard)
- **Why it looks this way** → [`DECISIONS.md`](DECISIONS.md)
- **What it's supposed to do** → [`USE_CASES.md`](USE_CASES.md)
- **Work-item ledger** → [`BACKLOG.md`](BACKLOG.md)

Horizons are intent, not dates. Last reviewed: **2026-09-06**.

Legend: **Now** = in flight · **Next** = near-term · **Later** = planned · **Someday** = conditional.

---

## Now

| Item | State | Notes |
|---|---|---|
| **Public-repo giveaway (D-045)** | Done | **MIT** — any purpose. History purged of the Calhoun export CSV and priced pitch HTML before visibility flip. |
| **FEC live-API sweep as primary** | Done in code | Local bulk index (D-028) is Tier 1; API sweep is fallback only (D-035). Remaining operator work: load older cycles. |

## Next

1. **Older FEC cycles** (`indiv22`, `indiv20`) into the bulk index — additive hit-rate lift; settled voters skipped on re-match. Loader is ready (ENH-014); remaining is download + load + a bracketed `repass-diff.ts`.
2. **Sunbiz re-measure after the address gate** (ENH-012) — record whether street corroboration recovers any real settles vs name+zip noise.
3. **Public follow-graph probe** (ENH-017) — Bluesky/X coverage on a small cohort *before* investing. OSINT stays a persona-linkage arm (D-033), not a settle arm.
4. **Workbench Phase 3** (ENH-019) — Review stage (conflict filter + waterfall controls in the panel) + Deliver recap + mobile/keyboard polish. Do **not** re-add the guide rail (D-037). Spec: [`plans/ENH-019-guided-workbench.md`](plans/ENH-019-guided-workbench.md).
5. **Manage-uploads UX** — discoverable delete / soft archive (`archived_at`) so a ledger isn’t lost.
6. **Name a pasted list** — intake already accepts `filename`; the UI still stores pastes as `pasted-list`.

## Resilience — recognize · adapt · deliver

Client files and upstream layouts change. Recovery is cheap (idempotent re-passes); detection should not be human-only. Ledger: ENH-006…011.

**Recognize** — funnel baselines + anomaly flags (ENH-006); golden-voter canaries (ENH-007, synthetic); format sentinels at intake (ENH-009); data-source verification table in `docs/CLAUDE.md` (✅).

**Adapt** — one lean-pattern registry (ENH-008, ✅); scorer version stamps; re-pass as an operation with before/after diff (ENH-010, ✅).

**Deliver** — deliverable versioning + delta reports (ENH-011); a one-click status paragraph from the box score.

**Norm for every new arm:** funnel metrics in `arm_runs` + a golden fixture + a data-source verification entry, before it ships.

## Later

1. **Automated test suite** — `USE_CASES.md` is the written spec. First targets: the two FL parsers, fusion, FEC/FL donation-lean, `buildResultsSql` (client+server sort parity).
2. **Batch inference re-enable** — document $/voter + coverage gates, then lift `LEANLINK_ENABLE_BATCH_INFERENCE`.
3. **Sunbiz lookup speed** — prefix/trigram on `officer_name_norm` if county-scale free-pass is still slow.
4. **Apify-modular evaluation** — curated subset vs `grok-full`; prefer FEC/media URLs over login-walled social.
5. **Scorecard Tier-A metrics** — donation / media / civic hit rates separate from social %.
6. **Exa-modular mode** (ENH-023 Phase 2) — Exa fetch → Grok synthesize; scorecard-gated. Not an Exa Agent lean engine.

## Someday

- **Geo/precinct lean prior** — only if OSINT coverage stays too thin (D-009).
- **Multi-tenant login** — `account_id` is the seam; single-operator today.
- **More reference indexes** — plug into `lib/evidence/arms.ts` when a source clears the public-records bar. Parked research: OpenPlanter is **not** a dependency ([`plans/ENH-027-openplanter-source-catalog.md`](plans/ENH-027-openplanter-source-catalog.md)).

## Open config forks

| Decision | Current default | The call |
|---|---|---|
| **Party-prior as a fusion settle arm** | Inert in fusion | Optional later. **Deliverable** party-vs-wallet is already D-044 (default wallet). |

## Non-goals

- **Outreach, targeting, or contacting individuals.** Intelligence, not a contact operation. (The MIT license does not change this product intent.)
- **Commercial data brokers.** Public records and open sources only.
- **Race / gender as model inputs** (D-010).
- **Attaching FL-DOS-extract data to an `account_id`.** Research-track (D-027).
- **Telemetry / phone-home.** A voter-records tool does not beacon (D-045).

## Recently shipped

**2026-09-06 — MIT (D-045):** free and open source, any purpose. Four Plums · four-plums.com · Michael@Four-Plums.com. Marketing HTML local-only.

**2026-07-23 — Lean conflict precedence (D-044):** deliverable resolves registration vs wallet (default wallet).

**2026-07-23 — Ingest universe (D-041):** NPA research / GOTV / custom, stored on the upload.

**2026-07-22 — Exa retrieval spike (D-040):** people/web fetch; Grok still judges. Thin NPAs stay empty.

**2026-07 — Evidence workbench + box score:** clickable innings, arm panels, single-source scoreboard (D-036); guide rail tried and removed (D-037); innings = scoring arms (D-038); re-fuse as a background job (D-039).

**2026-07 — Identity + committees:** street-address corroboration (ENH-012/013); committee classifier (ENH-018); OSINT re-scoped off finance DBs (ENH-016); re-pass diff (ENH-010); FEC bulk index (D-028); two-track extracts vs generic lists (D-027).
