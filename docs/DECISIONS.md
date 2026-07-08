# LeanLink — Decision Log (ADR-lite)

Why the project looks the way it does. Newest first. Each entry: the decision, the reason,
and what it overrides. This is the context the plan HTML loses when choices change — keep it
current as design shifts.

---

## D-039 · "Re-fuse now" is a background job — no size cap, no CLI, live in the box score
**Decision (2026-07-08, owner — found in prod validation):** Clicking "Re-fuse now" on a backlog
over 150 voters hit an inline cap and showed a message pointing at
`classify-committees.ts --apply` — which fires **Grok on the whole unlabeled census** (real cost +
unreviewed agent labels) as a side effect, when all the user wants is to re-fuse *already-labeled*
committees. Two problems: a legit serverless-time cap (per-voter re-fusion ~0.75s × 249 ≈ 187s >
the 120s route budget) and a **misleading, spend-y CLI hint**. Fix: make it a **background arm_run**
like every other long arm (the app's own live-progress pattern). The `refuse_all` route now creates
a `committee_refuse` arm_run and fire-and-forgets `triggerRefuseWorker`; the worker
(`refuse-worker/[runId]`, `maxDuration=800`) processes the pending committees single-pass with
per-committee commits + heartbeats (progress in the box score), self-chaining past the budget via
`arm_runs.meta.processed_committees` (resume-safe; also stops a genuinely-conflicted committee — one
that stays Undetermined after re-fusion — from looping). Removed the 150 cap and the CLI hint
entirely; the button just works at any size, Grok-free. New: `lib/committee-lean/refuse-runner.ts`,
`app/api/committee-lean/refuse-worker/[runId]/route.ts`, `listPendingRefusionCommittees`. No
migration (reuses `arm_runs`, migration 014). Not an ENH-019 regression — pre-existing ENH-018-UI
behavior surfaced during the D-036/037/038 prod validation.

## D-038 · Innings are scoring arms only; identity/context arms nest or footnote
**Decision (2026-07-08, owner):** In the box-score metaphor an inning is an *at-bat* — a chance
to put a lean on the board. Arms that can never score don't get an inning row (you wouldn't play
a baseball inning that grants your team no at-bat). Reclassified:
- **Innings (scoring):** FEC (T1), FL contributions (T2), OSINT (T3). `CORE_INNINGS` is now
  `['fec','fl_contrib','osint']`.
- **Sunbiz → identity enrichment, nested inside the FL contributions inning.** Sunbiz only
  confirms officer identity (structurally 0 leans); the leans it enables are booked as FL
  "entity" (layer-2) events. So it renders as an "Identity enrichment" section inside the FL
  contributions panel (`box.enrichments` → `EnrichmentSection`), where its "N officers identified"
  is now the *single* home for that number (no D-036 duplication). Its `match-sunbiz-entity`
  action + run history live there too.
- **Party (T0) → pre-game context, not an inning.** It's stored from intake and emits no lean
  (NPA lists carry none) — the lineup card, shown as a muted context line under the line score.
- **OSINT stays an inning** — it *can* score (its events carry a lean), just yields ~0 today; it's
  the intended future home for interactive "research arms" (system + researcher), built out over
  time. Keep the at-bat row.

Also: **clicking an inning row filters the voter list to that arm's hits** (reuses the existing
`armFilters` — no new query); collapsing clears it. Rendered in `lib/box-score.ts`
(`CORE_INNINGS`/`ENRICHMENT_ARMS`/`enrichments`), `components/box-score.tsx` (3 rows + party
context line), `components/arm-detail-panel.tsx` (`EnrichmentSection`), `components/evidence-workspace.tsx`
(`handleSelectArm`). Extends the pre-existing "Supporting arms" footnote distinction (household/
aliases were already non-innings). No migration, no new route.

## D-037 · No guide rail — navigation lives in the line score + ON BASE strip, not a linear spine
**Decision (2026-07-08, owner screen-read):** ENH-019 Phase 2 built a TurboTax-style guide rail
(a horizontal stage spine + a "NEXT UP" banner, from a pure `lib/guidance.ts`). On the live Duval
board the owner rejected it and it was removed **before any push**. Why it failed:
- **The spine duplicated the line score** — same arms (FEC/FL/Sunbiz/OSINT) as chips instead of
  rows, even mislabeled ("FEC federal" vs the row's "FEC donations"). A worse copy of the innings.
- **The banner duplicated the ON BASE strip** — both showed the same "249 voters behind labeled
  committees" number. A direct D-036 (single-source) violation.
- **The linear metaphor mis-signalled.** The spine reads left-to-right as sequential progress, but
  the flow isn't linear — it's "run the tier cascade, then chase opportunities." So a committee
  re-fusion (the highest-value *available* action) surfaced as "NEXT UP · Committees" after every
  arm was COMPLETE, which read as a *regression* ("why send me back?") even though it was the best
  next click. Metaphor (linear pipeline) fought logic (priority-based next action).

**Resolution:** navigation is the surfaces that already exist — **the line score is the progress
view, the ON BASE strip is the next-cheap-win prompt (with its own Re-fuse/Label actions), the arm
panels are the actions.** No linear pipeline/wizard surface. The pipeline cards it was meant to
replace are *also* retired (their actions moved into the arm panels in Phase 1). Removed
`components/guide-rail.tsx`, `lib/guidance.ts`, `scripts/smoke-guidance.ts`. Supersedes the
ENH-019 plan's Phase 2 (the guide rail); Phase 3 (Review/Deliver + polish) still stands. Lesson:
a guidance layer only earns its place if it says something the scoreboard doesn't — for a
power-user, single-operator tool over a non-linear flow, it didn't.

## D-036 · Scoreboard single-source discipline — one home per number, one term per concept
**Decision (2026-07-08, owner):** The box score is a *scoreboard*, and a scoreboard never
re-reports the same statistic in two places or renames it — the only allowed repetition is
period results + their aggregate (line-score cells → the total). Applied across the evidence UI:
- **The line-score row owns every per-arm funnel number** (In → Processed → ID hits → Lean
  signals → Settled → State). The arm detail panel's old "Funnel:" sentence duplicated the row
  and is **removed**; the panel now shows only what the row can't (explainer, game log, actions).
- **The top bar owns the aggregate/total** (records in · leans settled · still in research +
  by-lean split). `Leans settled` = the sum of the Settled column — the legit period→total
  exception.
- **One term per concept.** Run displays no longer say "confirmed"/"hits"/"leans" while the
  board says "ID hits"/"lean signals": unified to **ID hits** and **lean signals**; the run's
  raw pre-gate number is named **raw candidates** (a genuinely different stat, not on the board,
  so it's allowed — it lives only in the expanded game log).
- **The game log is a schedule, not a second line score.** Arms are the innings; a *run* is a
  game-log entry ("walked N rows · cli · 7/5"), carrying only the one off-board diagnostic
  (raw candidates), never the funnel outcomes again.
- **Review-queue metrics earn a slot only when non-zero.** `Conflicted` and `Accepted` are ~0
  until a human curates (and acceptance is an *override/QA* tool, never a required pass — the
  engine settles automatically at the confidence threshold, so the product scales to millions of
  NPAs without per-voter human review). They now render on the top bar only when > 0, and their
  permanent home is the Review surface (Phase 3).
- **Committee opportunity counts live once**, in the ON BASE strip — the fl_contrib panel shows
  the *action* (open manager), not the numbers.

Reason: on the 146k Duval board, the funnel sentence, the run-vs-board vocabulary drift, and the
0-accepted headline all read as either duplication or a false "human bottleneck" signal. Overrides
the ENH-019 Phase 1 arm-panel funnel sentence.

## D-035 · No live FEC API sweep in prod — freshness comes from a bulk-snapshot reload
**Decision (2026-07-08, owner):** Remove the per-voter **FEC live-API sweep** from the UI
entirely (deleted `components/fec-sweep-panel.tsx` and its ENH-019 FEC-panel disclosure). The
authoritative Tier-1 path is the **local FEC bulk index** (D-028); when the data needs to be
fresher, the right move is to **load a newer FEC bulk snapshot into Neon** (`scripts/import-fec-indiv.ts`,
SETUP §8a) — matching spans all completed `fec_indiv` snapshots, so a newer cycle is a pure
additive hit-rate lift. The live API sweep was slow, rate-limited, and never a production path;
keeping a button that sweeps 146k voters against `api.open.fec.gov` invited an expensive,
redundant run. **Open question (not yet decided):** whether to add an in-app *reference-data*
surface — read-only "what snapshots are loaded / how fresh" is a low-risk win; a *trigger-a-reload*
button is not (multi-GB download + load can't run in Vercel serverless, and a partial load would
poison matches), so a reload stays owner-gated CLI maintenance, same posture as OSINT and
county-scale runs. The FEC-sweep **backend** (route/worker/`fec_sweep_jobs`) is left in place but
UI-unreachable; fully retiring it is a separate backlog item. Overrides the D-028 note that
positioned the API sweep as the in-app fallback.

## D-034 · Point Grok at committees, not voters — the Tier-1/2 yield lever
**Decision (2026-07-07):** The constructive inverse of D-033. Grok is unreliable on anonymous
private voters but **excellent at classifying public political committees** (prominent, finite,
knowable). Measured: **31% of confirmed Duval FEC donors (208/678) sat Undetermined** purely
because their committee carries no party code and matches no pattern (Harris Victory Fund, union
PACs, the Lincoln Project). Fix, two parts: (1) **wire `committee_lean_labels` into the FEC
scorer** — it was FL-contrib-only, which is why federal donors could never be recovered by a
label (`inferContributionLean` now consults labels; federal + state share the one name-keyed
namespace); (2) a **Grok committee classifier** (`scripts/classify-committees.ts` →
`lib/committee-lean/classify.ts`) over the finite unresolved census — **one call per committee**
(batched, no web search), not per voter — with **bipartisan corporate PACs left Undetermined**
(CSX/Realtors/GuideWell — never manufacture signal). Precedence **human > agent > pattern**; a
human override reclaims `source='researcher'` and **locks** the committee. Measured on Duval: 70
committees classified for ~$0.05 → **+76 Tier-1 settles (470→546)**, +2 Tier-2 via FL re-fusion →
**478→556 settled, yield 0.32%→0.38%**. Committee manager v2 (ENH-018-UI) makes agent labels
reviewable/overridable (source badge + confidence + reasoning) and surfaces labeled-but-unfused
voters with a **"Re-fuse now"** action (`countPendingRefusion`/`refusionAllPendingForUpload`,
guarded at 150 voters → CLI). **Overrides:** the FEC scorer ignoring committee labels; the
assumption that raising yield requires per-voter research.

## D-033 · Tier-3 OSINT is an enrichment arm, not a settle arm; scoped to public expression
**Decision (2026-07-07):** Measured Tier-3 (Grok OSINT) on real voters — **0 leans on 5 rich
NPAs**, and a positive control of 10 known-signal voters (5 settled donors + 5 party-registered)
returned **only 1 lean**. Two walls, both structural: (a) **identity-linkage** of a private
individual to a confident online persona is unreliable (OSINT over-claims "probable"; a Bluesky
follow-graph probe found 33% name-collisions but **0% confident links** — a UK Labour MP matched
a Jacksonville voter); (b) even correctly-linked ordinary voters **post no codeable public
ideology**. So OSINT is a **persona/identity enrichment** arm, not a lean-settle arm — the pitch
was reframed (Tier 3 "assumed ~1,600 leans" → measured enrichment; headline "≈1,700 leans" →
"≈140 defensible leans + full intelligence on all 25,000 records"). OSINT was also **re-scoped**
(ENH-016): it had vestigially re-searched FEC/FL-finance/OpenSecrets (built in the June POC before
the index arms existed, never pruned) — now it targets **public political expression only**
(donations are resolved deterministically upstream by Tiers 1–2). The Bluesky follow-graph scorer
is **shelved** (coverage ≈0 for anonymous NPAs; the coverage probe is the per-client-list gate).
**Integrity lines held** under owner exploration: **no sock-puppet / authenticated FB-IG
scraping** (Meta ToS + covert access of private citizens + breaks the "public/open-source only"
client promise) and **no ad-targeting / lookalike data** (broker channel + "targeting" non-goal +
protected-class proxy). **Overrides:** the pitch's "assumed" Tier-3 settle yield; the OSINT query
plan's donation-database searches.

## D-032 · Street-address corroboration as the identity gate; Sunbiz tightened in place
**Decision (2026-07-06, Wave 2; owner call — "tighten in place" over "demote to opt-in"):**
Identity scoring gains a first-class **street-address** signal, in ONE shared helper
`lib/reference-data/address-match.ts` (`normalizeStreet`/`addressCorroboration` — never forked
per arm, the DEF-005/006 lesson). The Duval Sunbiz run measured 98,650 "confirmed"
name+zip officer hits / **0 settles**: against a 20.6M-row officer corpus, last-name+zip is
mostly collisions, and the layer-2 bridge rightly won't attribute a *company's* giving to a
same-named individual. **Sunbiz hard-gates on the street** (`scoreSunbizOfficerMatch`): a
match without a corroborated `officer_address` vs the voter's `residence.line1` caps below the
0.55 probable line → lands `ambiguous`, never settles; only a real officer at the voter's
address reaches `confirmed`. **Per-person clustering** (`run-voter.ts`): only
address-corroborated officers bridge to layer-2. **fl_contrib** (ENH-013) takes the same
corroboration as a *soft* bonus (lifts weak-band matches) plus a **recency-aware zip penalty**
(a zip match decays from full weight ≤4 yr to 0.5× ≥12 yr — churn makes a stale zip weaker
proof of current identity). FEC is unchanged: the bulk indiv file carries **no** street field
(dropped at load per D-028), so it stays zip+city. **Why tighten-in-place, not opt-in:** the
data shows real officers *are* in the pile, buried in collisions — address corroboration
recovers them instead of discarding the arm, and the same machinery is the general identity
upgrade that also helps fl_contrib. **No migration** — all three addresses are already
stored/selected; comparison runs in-memory over the migration-017 same-zip window.
`SCORER_VERSION` → 3; goldens (i)–(l) pin it (the collision-doesn't-settle canary fails the
old scorer). **Overrides:** the zip5+city-only identity scoring in `scoreSunbizOfficerMatch`
and `scoreFlContributionsAgainstVoter`; the ENH-012 "or demote to opt-in" alternative.

## D-031 · Lean-pattern registry: per-scope seeds, order preserved, scorer versioning
**Decision (2026-07-06, Wave 1 of the Resilience build):** Lean patterns move from two
hardcoded lists into the `lean_patterns` table (migration 019) with
`lib/lean-patterns/patterns.ts` as the byte-identical fallback — ONE source, editable
without a deploy. **Seeds are per-scope ('fec'/'fl'), never merged**, because scan order
encodes behavior: first-match-wins with Right→Left→Neutral block precedence, and the two
scanners order shared tokens differently ("WINRED REPUBLICAN FUND" → fec: WinRed/90,
fl: Republican/85 — a unified order would change confidences and evidence labels).
`sort_order` encodes the blocks (Right 10–90, Left 110–190, Neutral 300); 'both' scope is
reserved for future researcher-added rows. **Fallback rules:** missing table → fallback;
zero enabled rows → fallback (you cannot disable every pattern via enabled=false); invalid
regex rows are skipped, warned, counted in `meta.invalidCount`, and surfaced in the
committee manager's registry stats line. **Threading:** optional `patterns?` params
everywhere, loaded once at run boundaries (CLI startup, request start, FreePassContext) —
pure functions stay pure, un-threaded callers keep today's behavior exactly.
**Scorer versioning:** `SCORER_VERSION` (=2) stamps `payload.scorer_v` in all four event
builders; payloads without the key are implicitly v1 (pre-registry) — targeted re-passes
query `payload->>'scorer_v' IS NULL OR (payload->>'scorer_v')::int < N`. Event upserts
refresh the stamp on re-runs (intended). **Guards:** `scripts/smoke-golden-voters.ts`
asserts seed↔fallback parity and pins DEF-005/006/D-030 regressions; the anomaly-band
math (ENH-006: median ⅓×/3× bands, 1,000-processed floor, active runs only) is asserted in
the same script. **Overrides:** the hardcoded RIGHT/LEFT/NEUTRAL lists in
lib/fec/donation-lean.ts and lib/committee-lean/infer.ts (deleted).

## D-030 · Committee-master party feeds FEC lean; evidence itemizes receipts
**Decision (2026-07-05, found during the Duval validation run):** Two defects fixed together.
(1) The FEC bulk index stores each committee's **party code from the committee master**
(`cm.txt`, denormalized at load per D-028), but the index lookup dropped it before lean
scoring — lean depended entirely on name-pattern regexes ("winred", "actblue", "(REP)"…),
which FEC committee names rarely satisfy. Donors to committees of *known* party scored
"party unclear," suppressing Tier-1 yield (a likely contributor to Alachua's low 0.44%).
Fix: `lookupFecIndexForVoter` now folds the party into the committee display name
("NAME (REP)"), so the existing `\(rep\)`/`\(dem\)` patterns fire on authoritative data
(labels renamed source-neutral; DFL added as a Democratic affiliate). (2) A confirmed donor
with no derivable lean produced an evidence event with **no recipient lines at all** — the
researcher saw "identity confirmed" plus bare receipt URLs (observed on Duval row 113). Fix:
both FEC event builders (`fec_indiv_index` + `fec_sweep`) now always itemize confirmed
receipts — `$amount → COMMITTEE (PARTY) · date`, top 5 + "+N more" — and store them
structured in `payload.receipts` for the audit export. **Backfill:** evidence events upsert
(`DO UPDATE` on the dedupe key) and the claim predicate skips only settled voters, so
re-running the index match rewrites thin events in place; the in-flight Duval run was
restarted (~10k rows re-processed) rather than finishing the county on the old code.
Re-running Alachua later will enrich its events and may raise its measured yield.
**Overrides:** nothing — completes D-028's intent (the party column was loaded for exactly
this and never wired through).

## D-029 · Box-score dashboard: one pinned scoreboard, one polling loop
**Decision (owner UX notes, 2026-07-05):** Restructure progress visibility around a baseball
box-score metaphor — a **pinned scoreboard** (records in · leans settled · conflicted ·
accepted · still in research) always visible at the top of the page, a per-arm **line score**
(tier-ordered "innings": eligible-in → processed → identity hits → lean signals → settled
here), and a **current-inning** live strip for the running arm. All numbers derive from one
extended `UploadEvidenceSummary` (per-arm distinct-voter counts, `settled.by_arm`,
`waterfall.eligible_by_tier`) fetched by **one polling loop** (`useEvidenceSummary`: 5s while
a run is active, 30s idle, paused when the tab is hidden), replacing three competing
per-runner intervals. The old mid-page stats grid, cumulative scoreboard panel, and arm
badges were deleted rather than kept alongside — every number renders exactly once.
**Why:** operating on behalf of clients requires answering "where are we?" at a glance and
pasting accurate status into an update email; previously totals sat mid-page, per-arm counts
were badge pills, and live progress lived in three panels depending on which runner was
active. **Phase B (planned, migration 014):** an `arm_runs` table generalizing the
`fec_sweep_jobs` progress pattern (status/processed/heartbeat, one *active* run per
(upload, arm), history retained) written by every runner **including the CLI scripts**, so
county-scale index runs become visible to the dashboard; the FEC API sweep is adapted at
read time (UNION into the run shape), not dual-written. `eligible_by_tier` is a waterfall
before-state estimate after re-enroll cycles — arm_runs records exact per-run pools.
**Overrides:** `buildPipelineScoreboard`/`PipelineScoreboardPanel` and the evidence
workspace's self-owned summary polling (summary state now lives at page level).

## D-028 · FEC bulk index replaces the API sweep as primary Tier 1
**Decision:** Bulk-load FEC federal individual contributions (Florida-filtered, staged
most-recent-cycle-first) into Neon as the third reference index (`fec_contributions`,
migration 013), and make the local index the primary Tier 1 arm. The throttled Open-API
sweep stays as fallback (freshness, spot checks). **Why:** the 4-second API throttle puts a
40k-county sweep at 4–18 days of fragile self-chained serverless execution (observed live on
Alachua, 2026-07-04: ~94 rows/hr average with stall windows from FEC 429/5xx backoff, which
also killed idle-in-transaction Neon connections); the same match against a local index runs
in minutes, immune to rate limits. Also raises Tier 1 hit rate (cheap to load many cycles of
donation history) and makes turnaround a sellable feature. **Mechanics:** mirrors the
fl_contrib/Sunbiz pattern (reference_snapshots + normalized-name index) with two deliberate
differences — autocommit batches + unique `(snapshot_id, sub_id)` for **resumable** loads
(re-run to continue; `--fresh` to reload), and **live progress in the snapshot row**
(`row_count` + notes JSON) readable any time via `scripts/fec-indiv-status.mjs`; lookups only
use snapshots with `completed_at` set, so a mid-load index is never matched against. Names
match in FEC's "last first" order with generational suffixes stripped (`fecNameNorm`);
committee names/party are denormalized from the cycle's committee master at load time.
Evidence lands on the same arm ('fec', tier 1, source `fec_indiv_index`) so fusion,
settlement, and billing are unchanged. **Overrides:** the FEC API sweep as the default Tier 1
path (D-021 remains for per-voter lookups and fallback).

## D-027 · Two-track use posture: research-only is scoped to FL-extract data
**Decision (owner, 2026-07-04):** The "research/validation only" posture (D-005) was always a
guardrail on the *data source* — the FL DOS voter-registration extracts used during
exploration, which carry use restrictions excluding commercial/marketing use — not on the
enrichment activity itself. Exploration is complete; commercial engagements now proceed on
**client-supplied lists**. The posture becomes two-track: **Track A** — anything derived from
FL registration extracts (Calhoun/Alachua test uploads, professor work) stays research-only,
is never billed, and never enters a client deliverable; **Track B** — client-supplied lists on
per-client accounts, enriched from public records only, are commercial. **Guardrails made
structural:** migration 012 adds `voter_uploads_fl_extract_unbilled` (`CHECK (source_type <>
'fl_extract' OR account_id IS NULL)`) so an FL-extract upload can never carry a billing
account; the upload route never sets one on that path (now documented in-code); isolation is
already inherent — evidence/fusion/household are upload-scoped and the two intake paths use
disjoint identity hashes (`hashVoterPii` voterId-keyed vs `hashGenericVoter`
name/address/dob-keyed). **Retained on both tracks:** OSINT-only (no data brokers — now a
client-facing product promise), no race/gender inputs, withheld labels on conflict, no
resale/pooling. **Client responsibility:** the lawful basis for a list a client supplies is
the client's — capture in engagement terms. **Overrides:** D-005's blanket research-only
posture and its counsel-review tripwire framing (the tripwire attached to the FL-extract
data, which remains protected).

## D-026 · Pricing confirmed + researcher review controls (accept / re-enroll)
**Decision (pricing, owner-confirmed 2026-07-04):** Keep the migration-009 seeded rate card as
the client pricing — $0.03 baseline/record, $0.15 tier-1 (FEC), $0.25 tier-2 (FL/Sunbiz),
$0.33 + $0.05/attempt tier-3 (OSINT) — and add a **$2,500 initiation (kickoff) fee** as a
first-class rate-card fee + ledger kind (`initiation`, once per account ever, migration 011).
**Why:** Market comparables (researched 2026-07-04): setup fees of $1k–$5k are standard for
SMB data-service implementations; charged-on-match is the dominant append convention
($0.02–$0.03/match commodity append, $0.07–$0.20/hit batch skip-trace, $0.50–$2.00
investigative); **no modeled-partisanship vendor publishes per-score pricing** (L2/TargetSmart/
Catalist/i360 all quote-only), so there is no public like-for-like anchor. The ascending tier
ladder was kept over a flatter $0.18/$0.20 alternative because "deeper research costs more" is
the waterfall's sales story and tier 2 genuinely costs more to serve. At realistic FEC hit
rates on NPA lists (low single digits), the **baseline fee is the volume revenue driver**, not
the per-lean fees.

**Decision (review controls):** Billing settlement and research continuation are now separate
switches on `voter_lean_fusion` (migration 011). Default keeps the hard waterfall (settled ⇒
excluded). New researcher actions: **Accept** (`review_status='accepted'`) affirms the fused
lean — freezes the deliverable values (fusion stops rewriting them), excludes the voter from
all arms, and logs a `human_judgment` audit event; **Reopen** clears it; **Re-enroll**
(`research_status='re_enrolled'`, per voter or per cohort via `/api/uploads/[id]/re-enroll`)
pushes settled voters back into later arms — billing unaffected (settlement fee is
partial-unique-indexed, charged once ever). Advancement stays a **dashboard stage-gate**
(waterfall-gate strip: eligible-remaining count + projected max next-arm spend + explicit arm
buttons) — an exported file is never the control mechanism (no per-arm file round-trips;
export works at any stage). **Why:** the researcher needs to accept a lean without losing the
option to keep an NPA in research, and needs to see cost exposure before advancing a tier;
file round-trips would drift from the evidence ledger and re-ingest at cost. **Overrides:**
D-024's "later arms always skip settled voters" is now the *default*, not an invariant.

## D-025 · Lint gate: migrate `next lint` → ESLint CLI (flat config via FlatCompat)
**Decision:** `npm run lint` now runs `eslint .` directly. `eslint.config.mjs` loads
`next/core-web-vitals` + `next/typescript` through `@eslint/eslintrc`'s `FlatCompat`
(new explicit devDependency) and ignores `.next/`, `out/`, `build/`, `next-env.d.ts`, and
`.claude/**` (linked git worktrees that background agents create inside the repo — full repo
copies whose build artifacts would otherwise drown `eslint .`).
**Why:** the old config spread `eslint-config-next/core-web-vitals.js` into the flat-config
array, but `eslint-config-next` 15.x still exports eslintrc-format objects — every run died
with "nextCoreWebVitals is not iterable", so the pre-push lint gate was dead. `next lint` is
also deprecated (removed in Next 16), so this is the codemod-recommended migration (done by
hand for determinism). Rule expectations unchanged; the 8 findings the working gate surfaced
were fixed in the same commit. **Overrides:** the scaffold's `"lint": "next lint"` script.

## D-024 · Tiered / prepaid / waterfall billing + generic client intake
**Decision:** Turn the evidence engine into the product the one-pager sells. (1) **Generic
intake** — accept an arbitrary client list (name + one of county/ZIP/address required; no FL
voter file, no voter ID), normalized to `ParsedFlVoterRecord` so arms are unchanged
(`lib/generic-voter-list.ts`); per-row completeness score. (2) **Waterfall settlement** — a
confident lean (≥ `LEANLINK_SETTLE_THRESHOLD`) settles a voter at the cheapest contributing
tier and later arms skip it (`lib/evidence/settlement.ts`). (3) **Prepaid billing** — an
`account_id` holds a balance; charge **baseline** per record, **tier fee** per settled lean,
**OSINT attempt** per paid run; editable `rate_cards` (default + per-account overrides);
ledger `amount_usd` snapshots the rate (`lib/billing/*`, migration 009). **Why:** the value
is inferring lean for *unknowns*, priced by how much research it took; a hard waterfall (vs
pure fusion) makes the per-tier price meaningful and saves real API spend on already-found
voters. **Chose "hard stop above threshold"** over pure fusion (accuracy vs cost) and a
**baseline-per-record + attempt-priced OSINT** (vs pure success-only) to stop thin-data lists
consuming expensive attempts for free. **Overrides:** the `stack-spec.md` "No billing system"
non-goal. **Open (reversible config):** OSINT hit bills attempt + tier-3 (`osint_attempt_usd=0`
for tier-3 only); provided-party emits no lean yet (weak-prior recommendation). Single-operator
now; `account_id` is the seam to future multi-tenant login.

## D-023 · Multi-arm evidence accumulator + fused lean
**Decision:** Add `evidence_events` ledger (per voter, per arm) and `voter_lean_fusion` with
`lib/evidence/fusion.ts` rules. Each arm appends: identity band/score, optional lean signal,
evidence strings, URLs, cost. FEC sweep and OSINT test runs write events; fusion upserts
`lean_results` when status is `fused` or `provisional`. Dashboard **Evidence accumulator**
(split-pane command bar + voter timeline) sits above **Research lab** (former Analyze).
Arm registry in `lib/evidence/arms.ts` — pluggable per research effort. Pitch:
`docs/evidence-accumulator-pitch.html`. **Why:** Researchers need explainable lean labels built
from auditable sources, not one-shot model output; supports adding/removing arms (FEC, OSINT,
media, household) without rewriting the core.

## D-022 · Analyze UI: test subset + single test picker
**Decision:** Dashboard **Analyze** section takes an editable comma-separated **row-index
subset** (defaults to county curated ~7 rows), then one **test** choice: enrichment (single
active row), scorecard (all subset rows), Street View exploratory (single active row), or FEC
contributor lookup (all subset rows). Pipeline mode applies to enrichment/scorecard only.
Removed dashboard **Compare all modes** and **Street View strict** (API paths may remain).
**Why:** Researchers iterate on a fixed POC panel; one clear run action reduces mis-clicks and
cost. Strict Street View was redundant with exploratory for the professor validation workflow.

## D-021 · Direct FEC Open API for contributor lookup
**Decision:** Add `lib/fec/contributor-lookup.ts` + `POST /api/enrichment/fec` calling FEC
Schedule A (`/v1/schedules/schedule_a/`) by contributor name + FL state/city/zip. Optional
`FEC_API_KEY` (falls back to `DEMO_KEY`). Grok `site:fec.gov` queries remain in Tier-A plan but
are a poor substitute for structured search. **Why:** Limited tests showed near-zero yield from
indirect FEC web search; direct lookup is free, auditable, and isolates donation hit rate before
spending Grok credits. Disambiguation still manual (no employer on FL extract).

## D-020 · Batch inference disabled until POC validated
**Decision:** Full-file `Run Analysis Job` is blocked unless
`LEANLINK_ENABLE_BATCH_INFERENCE=true`. Dashboard shows per-voter tools only; `/api/uploads/[id]/run`
and the worker return 403; cron sweeper skips re-triggers. **Why:** A 40k-county upload at
~$0.03/voter Grok cost is ~$1.2k accidental spend; per-voter scorecard (~7 rows) is the
intended eval path until coverage and $/voter are acceptable.

## D-019 · Tier-A lean sources in query plan
**Decision:** Query planner includes donations/FEC, regional local media, and civic/professional
filings alongside social and directory queries. Prompts treat `donation|media|civic` platform
matches as valid lean signal carriers when `signals[]` has explicit ideology. **Why:** Social
profiles are sparse for rural NPAs; public donations and press quotes are higher-signal when
identity aligns.

## D-018 · Street View as separate research arm
**Decision:** Google Street View Static + Grok vision in `strict` (signage only) and `exploratory`
(visible-cue heuristics) modes. Output is `lean_street_view` — **not** merged into main OSINT
`lean`. Exploratory feeds `apify-modular` synthesis as weak context only. **Why:** High-quality
residential signal when imagery exists; professor can validate stereotypes in the field separately
from OSINT integrity rules.

## D-017 · Apify as fetch layer, Grok as synthesizer
**Decision:** `apify-modular` mode: Phase A parallel = Apify Google Search (top N query-plan
queries) + Street View exploratory; Phase B = Website Content Crawler on top organic URLs;
Phase C = Grok **synthesize only** (no `web_search`/`x_search`) with same lean guardrails.
Actors configurable via `APIFY_*` env; audit in `apify_runs`. **Why:** Deterministic, auditable
fetch without replacing Grok; pivot from D-008 "evaluate Grok first" once cost/auditability
required modular fetch.

## D-016 · Lean guardrail: signals must live in matches
**Decision:** `lean_signals_found` and labeled lean require non-empty `identity_matches[].signals[]`
with explicit ideological content — do not trust model `lean_signals_found` alone. **Why:**
Model sometimes claimed lean with empty signals; research integrity requires quotable public evidence.

## D-015 · Social-first OSINT + x_search + email insights
**Decision:** `grok-full` runs social-first query plan (email username variants, possible
maiden/alias from local-part, phone) with **x_search + web_search**; directories last.
`email_insights` derived from voter-file email (e.g. `ALICE.HAM` → maiden token `ham`).
**Why:** Row 13 proved contact info reaches people-search sites but not social profiles
with directory-first prompting.

## D-013 · Split identity resolution from lean inference
**Decision:** `identity_resolution_status` (found the right person?) is separate from `lean`
(ideological label). Directory/property hits count as identity even when `lean` stays
`Undetermined`. **Why:** All-Undetermined was uninformative — Ezra had a confirmed directory
match but no social/ideology; that is a meaningful POC finding, not a pipeline failure.

## D-014 · Modular enrichment modes for cost comparison
**Decision:** Four testable modes: `grok-full` (social-first + x_search + Tier-A), `apify-modular`
(Apify fetch + Grok synthesize), `modular-targeted` (query planner + capped searches),
`modular-synthesize` (no search baseline). Batch jobs would use `ENRICHMENT_MODE` when batch is
enabled; dashboard used to offer **Compare all modes** per voter (removed from UI in D-022;
`compare` flag on test API may remain). **Why:** ~$330/10k at full Grok search — compare modes
on curated rows before any county-scale run.

## D-012 · Primary history = mobilization only
**Decision:** PRI/PPP counts feed turnout/opposition context only — never infer party lean
from primary participation (FL history extract has no party-of-primary field). **Why:**
Avoid false precision; NPA primary choice isn't in our data.

## D-011 · No match → Undetermined
**Decision:** If OSINT resolution is `none` or `best_match_score` &lt; 0.25, force
`lean = Undetermined` and cap `confidence` at 35. **Why:** Research integrity; don't guess
without public evidence.

## D-010 · Hard exclude race/gender
**Decision:** Race and gender are never passed to Grok prompts or used in rules. **Why:**
Bias risk and weak signal for individual NPA lean; professor will want clean methodology.

## D-009 · OSINT-only lean (no geo prior v1)
**Decision:** Precinct/district geographic priors are **disabled** for lean inference in v1.
**Why:** Cleaner research story; add weak geo prior later only if OSINT coverage is too thin.

## D-008 · Grok live-search first for OSINT
**Decision:** v1 enrichment = xAI Responses API with `web_search` + `x_search`. Evaluate via
`POST /api/enrichment/test`, **POC scorecard**, and mode compare before county-scale batch.
**Why:** Fastest path to watch what Grok searches and returns. **Update (2026-06-27):** Apify
modular fetch added (D-017) for auditable retrieval; Grok remains synthesizer. **Spec:**
`docs/enrichment-pipeline.html`.

## D-007 · Living-docs artifact set
**Decision:** Standard complement = `README.md`, `CLAUDE.md`, `docs/README.md` (index),
`docs/SETUP.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/ROADMAP.md`, `docs/USE_CASES.md`,
`docs/COST-ESTIMATES.md`, `docs/enrichment-pipeline.html`, `docs/CLAUDE.md`, `LICENSE`.
`docs/USE_CASES.md` embeds its test cases (no separate `TEST_PLAN.md`); `docs/ROADMAP.md` added
2026-07-05 as the forward-looking counterpart to `PROGRESS.md`. `USER_GUIDE.md` (from the global
8-doc standard) is still deferred — single-operator, and `SETUP.md` covers the workflow. **Why:** Survive context drift
between sessions and across teammates (Michael, Claude, Grok Build); make the project
handover-ready. **Deferred:** CONTRIBUTING/SECURITY/CHANGELOG — overkill for a single-user POC.

## D-006 · Proprietary license
**Decision:** Closed source, all rights reserved (`LICENSE`). **Why:** Keep the option to
sell or license exclusive ownership; an OSS license would let anyone fork it. The actual
transfer of ownership happens via sale contract, not the repo file.

## D-005 · Educational-research use posture (OSINT-only)
**Decision:** Output is for a UF professor's research/validation/teaching — never to contact,
target, or resell person-level data. Enrichment is **OSINT-only** for the POC; no commercial
data brokers. **Why:** Data-broker / TCPA / CCPA regimes primarily bite on *contacting or
targeting* individuals — the research-only posture is what keeps the POC clear. Also,
vendors named in the original plan (Clearbit/FullContact) are moving targets. **Overrides:**
the original plan's commercialization framing and Clearbit/FullContact enrichment.
**Tripwire:** any shift toward outreach/marketing/resale → counsel review first.
**Scope narrowed by D-027 (2026-07-04):** this posture now applies to FL-DOS-extract-derived
data only; client-supplied lists proceed commercially on per-client accounts.

## D-004 · History-aware mock before Grok
**Decision:** Fallback mock in `lib/inference.ts` when `XAI_API_KEY` is missing or Grok
errors. **Why:** Pipeline stays runnable in dev without API spend. **Superseded for prod:**
when `XAI_API_KEY` is set, Grok live-search runs (D-008).

## D-003 · xAI/Grok for inference
**Decision:** Grok/xAI is the inference engine (house default). **Why:** Per org AI-vendor
preference. Wired via `lib/enrichment/grok-pipeline.ts` + `lib/xai/client.ts` (Responses API
+ `web_search`). See `docs/CLAUDE.md` for endpoint/model verification.

## D-002 · Serverless background jobs (no n8n)
**Decision:** Self-chaining Vercel worker + per-minute cron sweeper, instead of n8n or an
external queue. **Why:** One fewer system to run/own; the worker re-triggers itself to beat
function time limits, and the sweeper self-heals stalls. **Cost:** requires Vercel **Pro**
(`maxDuration = 800`); on Hobby, jobs silently stall. **Overrides:** the plan's n8n
orchestration.

## D-001 · Neon Postgres + raw `pg` + RLS (no ORM, no Supabase)
**Decision:** Neon Postgres accessed via raw `pg` with parameterized SQL; per-request RLS
keyed on `app.current_user` set inside `withUserDb`. **Why:** House DB default (Neon); raw
SQL keeps the data layer transparent for a small schema; RLS is defense-in-depth even though
the app is single-user today (eases any future multi-user move). **Overrides:** the original
plan's Supabase reference; the stale `supabase-schema.sql` was deleted.
