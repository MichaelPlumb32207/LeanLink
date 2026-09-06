# LeanLink — Build status

What’s actually built vs. gated vs. not started. A **scoreboard**, not a session log.
Last reviewed: 2026-09-06 (public MIT).

Session pickup notes live **outside the public tree** (not in git).

Legend: ✅ done · 🟡 works but partial / gated · ⬜ not started

## Pipeline

| Area | Status | Notes |
|---|---|---|
| Google sign-in, single-user lockout | ✅ | `lib/auth.ts`, `ALLOWED_USER_EMAIL`. |
| FL registration extract (38-field) + universe filter | ✅ | `lib/fl-voter-registration.ts`, `lib/ingest/universe.ts` (NPA / GOTV / custom). |
| Voting-history extract + turnout / mobilization | ✅ | `lib/fl-voter-history.ts`; opposition-mobilization is real math. |
| Generic list intake (CSV/paste/JSON, anchor gate) | ✅ | `lib/generic-voter-list.ts`, `/dashboard/intake`. |
| Upload → hash → batch ingest | ✅ | No Grok on upload. County-scale: `scripts/ingest-extract.ts` (dashboard body ~4.5 MB). |
| Waterfall settlement | ✅ | Later arms skip settled voters; `LEANLINK_SETTLE_THRESHOLD`. |
| Researcher review (accept / reopen / re-enroll) | ✅ | Fusion freeze on accept; claim queries honor locked / re-enrolled. |
| Job runner + stall sweeper | ✅ | Self-chaining worker. Full-file **batch inference is off** by default (D-020). |
| Box score + evidence workspace | ✅ | Pinned scoreboard, per-arm line score, arm detail panels, one polling loop (D-029 / D-036…039). |
| Deliverable + research export | ✅ | `/api/export/…/deliverable` under `lean_precedence` (default wallet). `?format=audit` is operator-internal. |
| FEC bulk index (Tier 1 primary) | ✅ | Local `fec_contributions`; live API sweep is fallback only (D-028 / D-035). |
| FL contributions + Sunbiz (Tier 2) | ✅ | Local indexes; Sunbiz hard-gates on street corroboration (ENH-012). |
| Committee lean labels + Grok classifier | ✅ | Human > agent > pattern; bipartisan PACs stay Undetermined (ENH-018). |
| Grok OSINT + four enrichment modes | ✅ | Per-voter / subset tests. OSINT is **persona linkage**, not a settle arm (D-033). |
| Exa retrieval spike | 🟡 | People/web fetch only; `exa-modular` mode not wired (D-040). |
| Apify fetch layer | 🟡 | `apify-modular` — needs live eval. |
| Street View vision | 🟡 | Exploratory research arm, not merged into main lean. |
| Geo / precinct lean prior | ⬜ | Deferred (D-009). |
| Automated tests | ⬜ | None. Spec: `docs/USE_CASES.md`. Goldens: `scripts/smoke-golden-voters.ts` (synthetic). |

## Measured (research findings)

Order-of-magnitude on Florida **NPA** lists from public records.

| Arm | What we saw | Takeaway |
|---|---|---|
| **Tier 1 FEC** (local bulk index) | ~0.3–0.5% determinate leans on NPA files (Alachua ~0.44–0.51%; Duval ~0.32–0.38% after committee labels) | Real but sparse. Older-cycle backfill (`indiv22` / `indiv20`) is the additive lever. |
| **Tier 2 FL + Sunbiz** | Identity-rich, settle-light (Duval ~0.005% settles before address gate; lots of name+zip collision noise) | Street corroboration is the gate. Treat as enrichment + committee text, not a volume settle arm. |
| **Tier 3 OSINT (Grok)** | ~$0.03/voter canary; **0 leans** on an NPA cohort; **1/10** on a known-donor control | Do not expect OSINT to settle lean. Scope it to public political expression (ENH-016); do not re-search FEC/FL/OpenSecrets. |
| **Committee classifier** | Public *committees* classify well; unlabeled census is the yield lever | Human > agent > pattern. Bipartisan corporate PACs stay Undetermined. |

Grok / Vercel / Neon **you** pay: [`COST-ESTIMATES.md`](COST-ESTIMATES.md).

## Known constraints

- Vercel **Pro** required when the worker’s `maxDuration = 800` is in play.
- Never run county-scale Grok without setting `LEANLINK_ENABLE_BATCH_INFERENCE` on purpose.
- FEC `DEMO_KEY` is tightly rate-limited — set `FEC_API_KEY` for real volume.
- Single-user by construction (`ALLOWED_USER_EMAIL`).
- `lean_results` uniqueness is **per upload** (D-043) — do not reintroduce a global `(user_id, voter_hash)` unique.
- FL DOS extracts are research-track (`account_id` stays NULL — D-027 / migration 012).
- License is **MIT** (D-045) — any purpose. Four Plums · four-plums.com · Michael@Four-Plums.com.
  Tips: `bc1qac237n8ekdr370ueyv8795fmm3gerdd5n27ahr`.

## Spec

- Index: [`README.md`](README.md)
- Architecture: [`../CLAUDE.md`](../CLAUDE.md), [`CLAUDE.md`](CLAUDE.md)
- Decisions: [`DECISIONS.md`](DECISIONS.md)
- Backlog (lessons): [`BACKLOG.md`](BACKLOG.md)
- Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Use cases: [`USE_CASES.md`](USE_CASES.md)
- Operator paths: [`USER_GUIDE.md`](USER_GUIDE.md)
- Enrichment map: [`enrichment-pipeline.html`](enrichment-pipeline.html)
