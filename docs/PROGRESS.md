# LeanLink — Build Progress

Running status of what's actually built vs. stubbed vs. not started. The honest source of
truth for "is the product done?" Update as work lands. Last reviewed: 2026-07-05.

## Legend
✅ done & real · 🟡 works but partial / gated · ⬜ not started

## Where to pick up (continuity note — 2026-07-08, ENH-019 Phase 2 guide rail built then DITCHED (D-037))

**A TurboTax guide rail was built, screen-read on the live Duval board, and removed — never
pushed.** The owner's read nailed it: the linear spine duplicated the line score (same arms as
chips, even mislabeled) and the "NEXT UP" banner duplicated the ON BASE strip (both showed "249
voters behind labeled committees" — a D-036 violation I'd introduced by adding the rail without
retiring ON BASE). Worse, the linear metaphor made the highest-value committee re-fusion read as a
*regression* — "NEXT UP · Committees" after every arm was COMPLETE looked like being sent
backward, when the logic just meant "best next click." Metaphor fought logic. Full rationale in
**D-037**.

**Removed** `components/guide-rail.tsx`, `lib/guidance.ts`, `scripts/smoke-guidance.ts`. The
workspace is now **line score (clickable innings → arm panels) + ON BASE strip (committee
opportunities + Re-fuse/Label) + waterfall controls (`<details>` advanced) + voter pane** — the
line score IS the progress view, the ON BASE strip IS the next-cheap-win prompt, the arm panels
ARE the actions. No linear pipeline/wizard surface (don't re-add one). The old pipeline cards +
steps-1–5 buttons stay retired (their actions live in the arm panels since Phase 1). The D-036
scoreboard cleanup is unaffected and already pushed.

**Lesson:** a guidance layer only earns its place if it says something the scoreboard doesn't — on
a non-linear flow for a single power-user, it didn't. **Next:** Phase 3 — Review stage (wire the
conflict filter, move the waterfall controls in) + Deliver recap + mobile/theme/keyboard polish.

## Where to pick up (continuity note — 2026-07-08, scoreboard single-source cleanup (D-036) — shipped on top of Phase 1)

**Phase 1 is pushed to main; this cleanup is the follow-up commit.** Owner walked the live Duval
box score inning-by-inning and articulated a scoreboard rule (**D-036**): one home per number, one
term per concept. Applied:
- **Removed the arm-panel "Funnel:" sentence** — it duplicated the line-score row. Panels now show
  explainer + game log + actions only.
- **Game log = schedule, not a second line score:** a finished run reads "✓ completed · walked N
  rows · cli · date" + the one off-board diagnostic ("N raw candidates before the identity gate").
  Dropped per-run ID-hit/lean counts (the board owns those, cumulative).
- **Unified vocab** in run displays: confirmed→**ID hits**, hits→**raw candidates**, leans→**lean
  signals** (live `RunStrip` + recent-run line).
- **`Conflicted`/`Accepted` render on the top bar only when > 0.** Rationale that matters:
  acceptance is an *override/QA* tool, NOT a required pass — the engine auto-settles at the
  confidence threshold, so the product scales to millions of NPAs with no per-voter human review.
  Their permanent home is the Review surface (Phase 3).
- **Committee counts live once** (ON BASE strip); the fl_contrib panel shows only the action.
- **FEC over-cap hint** no longer restates the row's count — just the cap + command.

Also logged two ideas from the walkthrough: **ENH-020** (read-only reference-data freshness surface
+ retire the UI-unreachable FEC-sweep backend) and **ENH-021** (T2-a: Grok/OSINT officer
corroboration to harvest the un-corroborated Sunbiz bucket — measure-first, find-don't-guess).

**Next:** Phase 2 — `lib/guidance.ts` (key off inning `state`) + `scripts/smoke-guidance.ts` +
`components/guide-rail.tsx`, then delete the pipeline-cards trio. Phase 3 folds Conflicted/Accepted
into the Review stage.

## Where to pick up (continuity note — 2026-07-08, ENH-019 Phase 1 shipped — clickable innings + arm panels)

**Phase 1 of the guided workbench is built, gated (tsc/lint/build + golden green), and
awaiting an owner screen-read before push.** Claude (Opus) reviewed Fable's plan against the
codebase first — it verified accurate; a 5-item amendment sheet lives at
`~/.claude/plans/gm-claude-i-had-glowing-floyd.md` (owner chose "commit to all three phases").
What landed:
- **Line-score rows are now clickable** (`components/box-score.tsx` `LineScore` gained
  `selectedArm`/`onSelectArm`/`renderDetail`; rows are `role="button"`, `aria-expanded`,
  Enter/Space operable, ▸/▾ affordance, one open at a time).
- **`components/arm-detail-panel.tsx`** (new) renders per-arm: role + honest explainer (from
  new pure registry **`lib/evidence/arm-details.ts`**), a funnel sentence off the
  `BoxScoreInning`, this arm's run history (`RunStrip` reused for active + a compact recent-run
  line), and the arm's actions. The FEC API sweep (`FecSweepPanel`) moved **into** the FEC
  panel under a "Fallback: FEC API sweep" disclosure; OSINT shows its CLI command + verdict and
  **no run button** (unchanged posture); over-cap arms show the `run-*.ts` CLI hint instead of
  the button.
- **`components/use-evidence-actions.ts`** (new hook) is now the single evidence-action POST
  path — old steps-1–5 buttons and the new panels share it; `confirmLongRerun` moved here
  (amendment 4) ahead of Phase 2's `pipeline-status.ts` deletion. `FecSweepPanel` de-wrapped
  from `pipeline-step` (amendment 3) so that file deletes cleanly in Phase 2.

Hard rails held: one polling loop (page-level `useEvidenceSummary`), render-once numbers (all
from `buildBoxScore`/`summary`), STATE still run-lifecycle (DEF-010), no new routes/migrations.
The old step buttons remain this phase (both paths share the hook).

**Owner screen-read on the live Duval box score (2026-07-08) → one product decision (D-035):**
the FEC live-API sweep is **removed from the UI** (deleted `components/fec-sweep-panel.tsx`; the
FEC panel now shows only the local-index action + a freshness note pointing at
`import-fec-indiv.ts`). Owner: never run a per-voter API sweep in prod; freshness = reload a newer
FEC bulk snapshot into Neon. Backend (route/worker/`fec_sweep_jobs`) left in place but
UI-unreachable — see ENH-020 for the open "reference-data status vs full retirement" question.
Also tightened the over-cap copy: the FEC row says "N **rows**" (it re-scores everything), the
free-pass arms say "N **eligible**."

**Next:** Phase 2 — `lib/guidance.ts` (key off inning `state`, NOT the `·0.5` heuristic) +
`scripts/smoke-guidance.ts` + `components/guide-rail.tsx`, then delete the pipeline-cards trio.

## Where to pick up (continuity note — 2026-07-07, Committee Manager v2 + re-fusion visibility (ENH-018-UI))

**Committee manager is now a real review/override surface + the re-fusion limbo is visible and
bookable.** Owner screen-read found three gaps, all fixed (plan mode → approved): (1) modal
**loading flash** (empty state rendered while `loading`) → gated behind `!loading`; (2) the
labeled section was **read-only with no provenance** → now shows a **source badge**
(Grok/Researcher), confidence, and Grok's reasoning, with **edit** (override → reclaims
`source='researcher'`, locks the agent) and **delete** (reverts affected voters via re-fuse);
(3) **re-fusion was invisible** — `classify --apply` had left 304 Duval FL voters
labeled-but-unfused → new `countPendingRefusion` + **"Re-fuse now"** action
(`refusionAllPendingForUpload`) surfaced in the manager AND the box-score "on base" strip
(`refuse_committees` opportunity). Backend: `deleteCommitteeLeanLabel`, provenance on the
labeled query, pending counter, bulk re-fuse, `DELETE` + `refuse_all` routes.

**Verification caught a real issue:** bulk re-fuse re-matches FL contribs per voter (~0.5–1s
each), so 304 voters took >2 min — too slow for a synchronous serverless POST. Fix: `maxDuration
= 120` + a **150-voter guard** → over that, the route returns a CLI hint (mirrors the free-pass
>5,000 guard). `classify --apply` now re-fuses the FL side too, so future runs don't create limbo
(the 304 was a one-time backlog from before that fix).

**Booked the 304 (via `refusionAllPendingForUpload`, what "Re-fuse now" calls):** 344 voters
re-fused across 42 committees; `repass-diff` reconciles — **Tier-2 (fl_contrib) settles 8 → 10,
partisan leans 600 → 604 (+7 new, −3 lost, 1 flip).** FL is settle-light (identity gating caps
name-only matches), and the −3/flip means the labels also **corrected** spurious weak leans —
accuracy, not just count. **Full committee arc on Duval: 478 → 556 settled (+78: +76 FEC, +2 FL),
yield 0.32% → 0.38%.** tsc/lint/build + 34 goldens green. Manager is polished ahead of the planned
**end-to-end client walkthrough** (owner has county data ready).

## Where to pick up (continuity note — 2026-07-07, committee classifier SHIPPED + measured (ENH-018 Unit B))

**Grok-on-committees works — the constructive payoff of the T3 dig is real and measured.**
Migration **020** (`'agent'` label source, applied to Neon), source-aware `upsertAgentCommitteeLabel`
(agent never overwrites a human; human override reclaims `source='researcher'` → **locks** — a bug
the rolled-back precedence test caught and I fixed), `lib/committee-lean/classify.ts` (batched Grok,
**no web search**, bipartisan→Undetermined), and `scripts/classify-committees.ts` (census FEC+FL,
`--dry-run`/propose/`--apply`, billed-account gate). **Measured on Duval:** 337 unresolved committees
/ 365 donors; the top-25 classify cost **\$0.004** and returned 11 partisan (176 donors) — Harris
Victory Fund→Left(100), NRA→Right(100), Team Kennedy→Independent, Remove Ron→Left, America First→Right,
Ban Assault Weapons Now→Left, NATCA→Left — while correctly leaving **every** corporate/bipartisan PAC
(CSX Good Government, Realtors ×3, GuideWell, UPS, Swisher, Crowley, Fidelity) Undetermined and not
guessing on unrecognized ones. Precedence verified: human > agent > pattern, human-override-locks.
tsc/lint/build + 34 goldens green.

**BOOKED + MEASURED on Duval (2026-07-07):** `classify-committees.ts --apply --limit 400` classified
all 337 unresolved committees (~$0.05), applied **70 partisan agent labels** (267 correctly left
Undetermined — CSX/Realtors/all corporate PACs, plus the long tail nailed: IBEW/Teamsters/Teachers
unions→Left, Green Party→Independent, Solar/Sunrise/TREE→Left, Chronister→Right), then the built-in
**targeted re-score** (only the 678 confirmed FEC donors, not the 146k county — 3 min) booked the
settles. **Result: Tier-1 settled 470 → 546 (+76); county waterfall 478 → 554; yield 0.32% → 0.38%
— a +16% lift in deliverable leans for ~$0.05 of Grok.** `repass-diff` reconciles exactly (+76
new partisan leans, 0 lost, 1 flip). The +76-of-264-behind-partisan-committees conversion is honest
— identity gating + conflict rules correctly withheld the rest. `classify-committees --apply` now
does write-labels → targeted-re-score → report in one shot (set_config session-scoped so RLS writes
work). **Remaining — ENH-018-UI (P3):** surface agent proposals in the committee manager for
one-click human review (CLI propose mode is the interim). **This is the answer to "point Grok at
committees, not voters"** — cheap, accurate, dodges every wall the OSINT arm hit.

## Where to pick up (continuity note — 2026-07-07, committee classification — Unit A wiring (ENH-018))

**The constructive payoff of the T3 dig: point Grok at committees, not voters.** Owner spotted a
confirmed FEC donor to THE LINCOLN PROJECT stuck Undetermined. Measured: **208 of 678 confirmed
Duval FEC donors (31%)** sit Undetermined because their committee carries no party code and matches
no pattern (Harris Victory Fund 21, Aaron Bean Team, union PACs, Lincoln Project). Grok can't ID
anonymous voters but *can* classify public committees trivially — so the fix is committee-level.
**Filters bug (DEF-011) fixed first** (debounce + decouple-from-poll + latest-wins + live totals).
**Unit A shipped (the wiring):** the FEC Tier-1 scorer now consults `committee_lean_labels`
(`inferContributionLean` → label beats pattern; threaded through `scoreFecLookupForVoter` /
`inferLeanFromDonations` / `run-index-upload`, loaded at the CLI + `match-fec-index` API boundaries).
Previously FEC ignored labels entirely (state-only) — that was the gap. Federal + state share the
one name-keyed namespace. Golden **(n)** pins it (unlabeled→Undetermined, labeled→Left). So a re-run
of `run-fec-index` after labeling now settles the recoverable donors. tsc/lint/build + 34 goldens green.

**Design (owner-approved, all 5):** (1) federal+state shared namespace; (2) agent classifies at
T1/T2 over the committee census, not T3; (3) agent never overwrites a human label; (4) human
overrides anything and locks it; (5) on billed accounts the agent *proposes*, a human confirms
before it settles+bills. **Unit B (next):** migration to add `'agent'` to the source CHECK,
source-aware `upsertAgentCommitteeLabel`, the Grok committee classifier over the unresolved census
(**bipartisan corporate PACs → Undetermined, don't manufacture signal**: CSX Good Government 41,
Realtors, Microsoft), and the billed-account review gate. Then measure recovered settles on Duval
via `repass-diff`.

## Where to pick up (continuity note — 2026-07-07, T3/OSINT measured + re-scoped (ENH-016))

**Measured Tier-3 OSINT and found it was doing the wrong job.** Two live runs (owner-approved,
~$1.4 total, hard-capped): (1) `run-osint-cohort.ts` on 5 rich NPAs → **0 leans, 0 trails** (identity
"probable" 5/5, but every evidence line "no ideological content"); (2) `osint-control-test.ts` — a
**positive control** on 10 voters with a KNOWN signal (5 settled donors + 5 party-registered
Calhoun) → **only 1/10 leaned**, and **3/5 documented donors had no trail at all**. Root cause,
confirmed in the prompt code: a large slice of every grok-full call was web-searching
`fec.gov`/`dos.myflorida.com`/OpenSecrets — the exact datasets Tiers 1–2 already resolve
**deterministically**. The OSINT arm was built in the June POC *before* those indexes existed and
was never re-scoped; it's been paying to re-find what we already have, badly. **Two findings that
generalize:** (a) OSINT's real competency is **persona linkage (identity)**, not lean — it finds the
right LinkedIn/FB but ordinary people post no codeable ideology; (b) lean comes from overt public
acts, and the cheapest tier already captures the common one (donations).

**Re-scope shipped (ENH-016):** `query-builder.ts` → `buildPublicExpressionQueries` (drops the 5
donation-DB queries; keeps activism; adds endorsement / self-identified-ideology / volunteer);
`prompts.ts` TIER_A block + user-prompt label + modular step-3 now target "public political
expression" and explicitly say **do NOT search FEC/finance sites — resolved upstream**. Field name
`donations` kept for the payload contract. tsc/lint/build + 32 goldens green.

**Ruled out on the record** (owner explored, we held the line): advertiser-targeting data (broker
channel + "targeting" non-goal + proxy-for-protected-class) and **sock-puppet/agent browsing of
FB/IG** (fake accounts + automated collection = Meta ToS violation, covert access of private
citizens, and it breaks the client-facing "public/open-source only" promise). The legit frontier is
the **public** X/Bluesky follow-graph.

**ENH-017 measured — follow-graph scorer shelved (coverage≈0).** Built `lib/bluesky/client.ts`
(public AppView API, no auth) + `scripts/bluesky-coverage-probe.ts` and probed *before* building the
scorer. On 30 eligible Duval voters: **33% share a name with a Bluesky account, but 0% are
confidently linkable** (0 email→handle matches, 0 FL signals). The 9 name-matches were provably other
people — a UK Labour MP ("Anna Dixon"), a Brown postdoc ("Andrea Bryant"), an NYC White-House alum
("Luke Farrell"). **The wall is identity-linkage of a private individual to a social account — the
same wall the OSINT arm hit — not graph mechanics.** Decision: don't build the registry+scorer for
anonymous NPAs; keep client+probe as reusable per-list instruments (a public-facing client list would
score higher — the probe is the gate). X stays out (no clean API + same linkage wall).

**The through-line across the whole T3 investigation:** OSINT can *find* people (persona linkage) but
can't reliably (a) *link* an ordinary private voter to a confident online identity, or (b) find
*codeable ideology* on the ones it does link — because rank-and-file NPAs neither post politics nor
are prominent enough to disambiguate. Every avenue (authored posts, donation re-search, follow-graph)
hit one of those two walls. **Product conclusion: Tier-3 OSINT is a low-yield persona-enrichment arm,
not a lean-settle arm — the pitch should say so** (it currently "assumes" T3 settles). Total T3
investigation spend: ~$1.4, all capped. Open owner decision: formally reframe T3 in the pitch
(enrichment, not settle) vs. keep exploring; the measurement strongly favors reframing.

## Where to pick up (continuity note — 2026-07-06, Tier-3 capped OSINT harness READY (ENH-015))

**Tier-3 OSINT measured-cohort harness built — awaiting owner go for the paid run.**
`scripts/run-osint-cohort.ts` is the only arm that spends real money per voter (paid Grok),
so the spend cap is belt-and-suspenders: `--limit` (voter ceiling, default 100), `--max-usd`
(hard cap, default $5 — stops **before** any voter that could breach it), `--est-usd`
(per-voter guard). The cap binds on `max(reported spend, processed × est)`, so an API that
under-reports cost still can't run past `max-usd / est` voters; the run is **sequential** to
keep the cap exact. `--dry-run` previews the cohort + projected cost with **zero** Grok calls.
Two cohorts: `rich` (email/history-bearing eligible voters → Tier-3 *upper-bound* yield, the
default) and `sample` (deterministic md5 spread → representative of the whole remainder). It
writes an OSINT evidence event + fuses each voter (settlement/tier-fee only bill if the upload
carries a billing account — the Duval FL-extract research upload never does, so the run is
measured-but-unbilled), records arm_runs lifecycle (box score shows it live), and Ctrl-C marks
it cancelled. **Verified dry-run on Duval:** 100 eligible voters (rich: 100/100 with
email+history; sample: 21 email / 68 history), cap projection correct ($5 cap → ~$5 max at
$0.05/voter; $1 cap → ~$1). tsc/lint/build clean. **Owner-gated remainder:** run it live
(`--county DUV --limit 100 --max-usd 5`, owner-approved single-digit-dollar cap per
[[build-out-waves]]), bracket with `repass-diff` (ENH-010), and record the measured Tier-3
yield here + in the pitch (currently "assumed"). **This closes Wave 2 build-out** (all code
shipped; three measurements remain operator-gated: Sunbiz re-measure done, FEC backfill load,
Tier-3 run).

## Where to pick up (continuity note — 2026-07-06, FEC multi-snapshot backfill CODE READY (ENH-014))

**FEC index now matches across ALL loaded cycles — indiv22/indiv20 backfill is code-ready.**
The blocker was architectural: `getActiveFecIndivSnapshot` returned the single newest
`fec_indiv` snapshot and `lookupFecIndexForVoter` took one `snapshotId`, so a backfilled cycle
would never be searched. Fix: `getActiveFecIndivSnapshotSet` (all completed snapshots,
newest-first, combined label like `2024-fl+2022-fl+2020-fl`) + `lookupFecIndexForVoter(client,
ids[], record)` on `snapshot_id = ANY($1)` — the existing name indexes (`contributor_name_norm`
[+zip], text_pattern_ops prefix) serve it unchanged, **no migration**. Threaded through
`run-index-upload.ts` (`snapshot`→`snapshots: FecIndexSnapshotSet`), `run-fec-index.ts` CLI
(prints `FEC index snapshots (N): …`), and the dashboard `match-fec-index` action. **Verified
live (read-only):** the `ids[]` path returns identical hits to the old single-snapshot path
(8/13/0 on Duval confirmed-donor samples); the set currently resolves to just `2024-fl`.
tsc/lint/build clean. **Operator-gated remainder:** download indiv22.zip+cm22.zip and
indiv20.zip+cm20.zip (~2 GB each), load each under its own `--label` (SETUP §8a; ~30 min/cycle,
resumable), then a `repass-diff`-bracketed `run-fec-index --county DUV`/`ALA` to measure the
Tier-1 lift. Settled voters are skipped on re-match, so it only touches the unsettled. **Next in
Wave 2:** Tier-3 capped OSINT cohort.

## Where to pick up (continuity note — 2026-07-06, ENH-010 re-pass diff SHIPPED)

**ENH-010 complete — re-pass is now a product operation with a before/after diff.** The
supersede half landed early (DEF-009 `deleteVoterArmEvents`); this adds the delta report.
`lib/evidence/repass-diff.ts` (pure): `captureRepassSnapshot(client, uploadId)` snapshots the
deliverable-relevant fusion state per voter (lean, confidence, settled_tier/arm, review_status,
contributing arms); `diffRepassSnapshots(before, after)` computes settles gained/lost + tier
changes, leans gained/lost/flipped, net partisan, same-direction confidence movement,
arm-set-changed, frozen-skipped, and a severity-ranked `notable` sample; `formatRepassDiffMarkdown`
renders it. CLI `scripts/repass-diff.ts` brackets any re-pass: `snapshot --county DUV` before →
run the re-pass (run-fec-index / run-free-pass) → `report --county DUV` after (JSON baseline in
CWD, read-only, no migration). **Validated on live Duval:** self-diff reconciles exactly — 478
settled (470 fec + 8 fl_contrib), 524 partisan, 0 spurious deltas. Golden **(m)** pins the
DEF-009 supersede shape (tightened re-pass drops 2 spurious bridge-leans, leaves real + frozen
settles untouched); 32/32 goldens pass, tsc/lint/build clean. UI "re-score" button intentionally
deferred to ENH-011 (deliverable versioning/delta attachment). **Next in Wave 2:** FEC cycle
backfill (indiv22/indiv20) → Tier-3 capped cohort.

## Where to pick up (continuity note — 2026-07-06, box-score STATE = run lifecycle, DEF-010)

**Line-score STATE no longer rests on PARTIAL by design.** Owner flagged that Sunbiz read
PARTIAL despite a clean `completed` run. `inningFor` (`lib/box-score.ts`) derived STATE from
event coverage (`voters_touched >= eligible_in`), which a hit-only arm (Sunbiz writes an event
only on a match) can never satisfy. Now STATE reads the arm's run lifecycle
(`summary.runs.recent[].status`, already in the summary): completed → **COMPLETE** (renamed
from `run`; all finished arms match the pipeline cards), cancelled/failed → **PARTIAL** (the
only remaining use — a genuine interruption), heuristic kept as the run-less fallback.
PROCESSED shows `max(run.processed_count, voters_touched)` so FEC reads 146,599 and Sunbiz
146,121 (not 46,124). Verified against the live Duval summary; gate green; **deployed +
owner-smoke-confirmed** (all arms COMPLETE/NOT RUN, no by-design PARTIAL). Two files
(`lib/box-score.ts`, `components/box-score.tsx`), no migration.

## Where to pick up (continuity note — 2026-07-06, Wave 2 identity gate SHIPPED + MEASURED + deployed)

**ENH-012 + ENH-013 shipped (address-corroboration identity gate).** The 2nd Duval Sunbiz T2
confirmed the noise on-screen (99,360 hits / 98,650 "confirmed" / 0 settles — loose
last-name+zip against 20.6M officers). Root cause: the identity gate never looked at the
street address, though every side carries one at match time (voter `residence.line1`,
`officer_address`, fl_contrib `address`) and it was selected-then-discarded. Fix (owner call:
**tighten in place**), all behind one shared helper `lib/reference-data/address-match.ts`
(no per-arm fork — DEF-005/006 lesson): (1) **Sunbiz hard gate** — `scoreSunbizOfficerMatch`
caps any match without a corroborated street below the 0.55 probable line, so collisions land
at `ambiguous` (never settle) while a real officer at the voter's address still reaches
`confirmed`; (2) **per-person clustering** — only address-corroborated officers bridge to
layer-2 (`run-voter.ts`); (3) **fl_contrib** street bonus (soft) + **recency-aware zip
penalty** (stale zip match decays to 0.5×). `SCORER_VERSION` → 3; goldens (i)–(l) added (the
collision-doesn't-settle canary would fail the old scorer). **No migration** — matched
in-memory over the migration-017 zip window. Gate green: tsc/lint/build clean, 25/25 goldens
pass.

**MEASURED (Duval Sunbiz re-run, v3, 146,121 processed):** raw qualifying hits **99,360 →
46,124** (the −0.25 address-mismatch penalty culls the weakest substring-name collisions
below the 0.45 floor entirely). Of the 46,124: **confirmed 25,663 (56%) / ambiguous 20,461
(44%)** — vs the old 99.3%-confirmed. Spot-verified **200/200 confirmed are real
exact-address officer matches, 0 false confirms** (FL is full of home-registered LLCs, so
address corroboration is genuinely common). Layer-2 partisan leans **46**; **Sunbiz settles
0** (tier-2 stays 8, all fl_contrib layer-1). Verdict: the gate works — Sunbiz is now a
*trustworthy* identity/enrichment arm, still not a settle arm (officer status ≠ partisanship).

**DEF-009 found on the same screen-read (owner caught it):** the box score still showed
78,501 "confirmed" because the re-pass left **53,236 stale sunbiz + 5,244 stale layer-2**
pre-gate events in place — the runner only writes/updates events for voters WITH a hit and
never *superseded* the old event when a voter stopped matching (78,501 = 25,663 fresh +
~52,838 stale). Fixed: `deleteVoterArmEvents` (`lib/evidence/ledger.ts`) wired into both
free-pass branches (`lib/free-pass/run-voter.ts`) so a tightened re-pass self-cleans; the
existing Duval rows reconciled via `scripts/cleanup-stale-sunbiz.ts` (dry-run default,
`--commit` to apply; operator-run — deletes only stale scorer_v rows, re-fuses the 625
lean-carrying layer-2 voters, verified 0 rows on settled/accepted). Post-cleanup the box
score reads the true **25,663**. This is the seed of ENH-010 (re-pass as a product op with
supersede + diff).

## Where to pick up (continuity note — 2026-07-06, Resilience Wave 1 SHIPPED)

**Wave 1 complete (ENH-006/007/008 — the trust & safety rails).** (1) **Pattern registry**
(migration 019, applied): 35 seeds per-scope in scanner order (D-031 has the rationale);
`lib/lean-patterns/{patterns,registry}.ts` is THE source (hardcoded lists deleted from both
scanners); threaded through the entire FEC chain (index CLI/API, sweep worker, retry cron,
sync, rescore, disambiguate) and FL chain (free-pass context, refusion, queue, summary
counter); `SCORER_VERSION=2` stamped in all four builders; registry stats line in the
committee manager. Pattern edits = SQL for now (ENH-008-UI deferred). (2) **Golden voters**
(`scripts/smoke-golden-voters.ts`): 26 assertions pinning DEF-005/006/D-030 + identity
gates + conflict fusion + seed parity + anomaly math; `--offline` mode; **caught a real
subtlety on first run** (single-receipt aggregate confidence deflates by identity score —
existing behavior, fixtures model multi-receipt donors). (3) **Anomaly flags**
(`lib/evidence/run-baselines.ts`): median ⅓×/3× bands vs prior completed runs (cross-upload,
1,000-processed floor, sweep priors excluded from lean median), computed at read while runs
are active, amber ⚠ lines in the RunStrip. **Next: Wave 2** (identity upgrades → re-pass
diff → FEC backfill → Tier 3 capped cohort) per the approved build-out plan; the Duval
Sunbiz run's result still lands in the note below when it completes.

## Where to pick up (continuity note — 2026-07-06 midday, Resilience adopted + pitch recalibrated)

**Resilience plan adopted (owner: "implement all of it"):** ROADMAP gains a dedicated
**Resilience — recognize · adapt · deliver** horizon (funnel anomaly flags, golden-voter
canaries, unified pattern registry + scorer_v, format sentinels, re-pass-with-diff,
deliverable deltas + status snapshot; ENH-006…011 in BACKLOG with priorities). The
data-source verification table shipped immediately (docs/CLAUDE.md — FL extract, FEC bulk,
FL contributions, Sunbiz COR layouts + re-verify triggers). New-arm definition of done:
funnel metrics + golden fixture + verification entry. **Outward docs recalibrated to the
measured story:** pitch worked example now uses the T1 band (0.32–0.51%, two counties/187k
voters), honest Tier 2 evidence-rich framing, county-in-2h turnaround, receipt-level audit
language; one-pager gains "Proven at county scale"; OnRecord mirrors regenerated via the
documented sed (never hand-edit). Duval Sunbiz run still in flight (~12/s).

## Where to pick up (continuity note — 2026-07-06 morning+2, Tier 2 perf trilogy + On-base strip)

**DEF-007/DEF-008 (the leading-wildcard family, members 2 and 3):** the first Sunbiz county
run crawled at 0.5/s (ETA 72 h) despite migration 015 — the officer lookup matches with
`LIKE '%<last>%'` (btree-unusable; 015 indexed the wrong shape — *benchmark the exact query
shape*), and the layer-2 entity lookup did the same over 14.2M fl_contributions up to
3×/voter, plus two static snapshot-label queries per voter. Fixes: migration **017**
(officer zip index) + explicit zip-required query shape (the `($x='' OR col=$x)` optional
param blocked the index); migration **018** (text_pattern_ops prefix index) + prefix-only
entity matching; labels hoisted into FreePassContext; workers heartbeat every 45 s in-txn
(no more false "stalled?" on slow arms). **Measured: 0.6/s → 12/s**; Duval Sunbiz run in
flight (~3.5 h). **On-base strip shipped (owner UX):** the unlabeled-committees counter
moved from a flag line by the button into a violet **"On base — runners in scoring
position"** strip directly under the line score — `BoxScoreOpportunity[]` in
`lib/box-score.ts` is data-driven so future cheap-action opportunities (re-enroll cohorts,
review queues) plug in beside the innings; action buttons map ids in the workspace.

## Where to pick up (continuity note — 2026-07-06 morning+1, Sunbiz unlocked + committee counter)

**ENH-001 done (migration 015):** `(snapshot_id, officer_name_norm)` index over 20.6M
Sunbiz rows — officer lookups ~7 s → **~53 ms**; county-scale step ⑤ feasible for the
first time. **First Duval Sunbiz run launched** (`--steps sunbiz --concurrency 8`,
arm `sunbiz`) — first measured Sunbiz/layer-2 numbers ever, and the first with layer-2
party codes working (DEF-006). **Unlabeled-committees counter shipped:**
`summary.committees {unlabeled_count, voters_affected}` — (eligible voter, committee)
pairs from fl_contrib event payloads, filtered live through patterns + researcher labels
(labeling shrinks it next poll, no re-pass). Migration **016** partial index keeps the
poll cheap — note the predicate tests **non-empty** `unresolved_committees` (events carry
an empty array when none; a bare `?` existence test matches everything and narrows
nothing — first version of 016 made that mistake, measured, fixed). UI: count badge on
the "Committee lean labels" button + flag line with voters-affected (ENH-005 workflow).
**Identity-scoring upgrades still queued** (street-address corroboration, recency-aware
zip penalty, per-person hit clustering — the plan from the T2 improvement discussion).

## Where to pick up (continuity note — 2026-07-06, Duval Sunbiz DONE — Tier 2 chapter closed)

**Duval Sunbiz (step ⑤) COMPLETE — the honest Tier 2 verdict.** 146,121 processed in
2h43m (~15/s, 8 workers, clean completion): **99,360 officer-name hits (68%), 98,650 at the
event's confirmed/probable band, but 0 Tier 2 settles from Sunbiz** (county waterfall
unchanged at 478 = 470 T1 + 8 T2-from-fl_contrib). The 68% "hit" / 98k "confirmed" are
**loose last-name+zip matches against 20.6M officer rows — overwhelmingly name collisions**,
which is exactly why nothing settles: the layer-2 bridge (voter → same-named officer →
their corp → corp's FL donations) can't confidently attribute a *company's* political
giving to an individual who merely shares a name — and shouldn't. **Product finding:**
Sunbiz as constituted is **neither a settle arm nor a clean evidence arm** — it's noise at
county scale. Candidate action (new ENH): tighten the officer identity gate (require
street-address match, not just name+zip) before Sunbiz earns its place in the default
pipeline, OR demote it to opt-in. Full measured Tier 2 = fl_contrib 8 settles (evidence-rich,
D-030/DEF-006 era) + Sunbiz 0 (noise). Pitch Tier 2 framing ("enrichment, not settles") is
now doubly confirmed. **Next: Wave 2** ([[build-out-waves]]) — identity-scoring upgrades are
the direct lever on both this and fl_contrib's 419 unlikely-band hits.

## Where to pick up (continuity note — 2026-07-06 morning, Tier 2 MEASURED)

**Duval Tier 2 re-pass complete (post-DEF-006): 8 settled at Tier 2.** County waterfall
now: **478 settled** (470 T1 + 8 T2 · 238 Left / 240 Right · 0 conflicted). The honest
Tier 2 finding: from 465 FL person-name contribution matches, party-coded committees now
emit lean signals (DEF-006 fixed), but **identity gating dominates** — FL person-name
matches without address corroboration mostly land in weak identity bands, so fusion
withholds. Measured Tier 2 settle yield: **~0.005%** (8/146,129) + substantial evidence
enrichment (465 hit voters, 92,483 household anchors, 238k events). **Pricing
implication:** the pitch's assumed Tier 2 numbers were far too optimistic — Tier 2 as
constituted is an *enrichment* arm, not a settle arm; revenue concentrates in baseline +
Tier 1. Levers to raise T2: researcher labels for ambiguous PACs (ENH-005), and
(research direction) FL identity corroboration via address/occupation fields in the DOS
contribution data. Next unmeasured tier: **Tier 3 / OSINT** (paid; stage-gate).

## Where to pick up (continuity note — 2026-07-06 ~1am, Tier 2 first pass + DEF-006)

**Duval Tier 2 (fl-contrib) first pass COMPLETE — and it found DEF-006.** Clean run:
146,129 voters in 2h16m (~18/s, 8 workers), 465 with FL person-name contribution matches,
92,483 household anchor events, **0 Tier 2 settles**. The zero was the tell: the
unresolved-committee census (521 distinct names over 453 voters) had "DeSantis, Ron
(REP)(GOV)" 39 voters · "Crist, Charlie (DEM)(GOV)" 27 · "Gillum, Andrew (DEM)(GOV)" 19
sitting *unresolved* — `lib/committee-lean/infer.ts` had its own copy of the DEF-005
`\b\(` bug (lines 17/18/28), so Tier 2 could never read FL party codes. Fixed (codebase
swept — no further instances); **Duval fl-contrib re-pass launched** (~2h15m). Expect the
first real Tier 2 settles from party-coded candidate committees; remaining unresolved
committees are the genuinely ambiguous PACs → researcher labeling workflow (ENH-005,
census top-12 recorded there). Household/hits evidence from the first pass upserts
unchanged. Record final Tier 2 yield here when the re-pass completes.

## Where to pick up (continuity note — 2026-07-06 overnight, Tier 2 hardened + two runs in flight)

**Free-pass runner hardened (closes ENH-003):** `lib/free-pass/run-upload.ts` refactored —
`loadFreePassContext` (household index + labels + snapshot ids load **once**, shared
read-only across workers), `claimFreePassRows` on `CLAIM_ELIGIBLE_PREDICATE`, per-voter
`runFreePassVoterWithContext` (voter-scoped writes incl. inline fusion → parallel-safe).
CLI `run-free-pass.ts` rewritten to the run-fec-index pattern: `--steps
fl-contrib|sunbiz|all`, `--concurrency` (default 4/max 16), `--start-after`, arm_runs
start/heartbeat/finish (heartbeat also tallies settled-at-arm so the strip's "leans" is
real), SIGINT→cancelled. Dashboard free-pass actions now **guard at 5,000 eligible**
(400 + CLI hint) and run chunked (250/txn) with arm_runs when under it. **Calhoun smoke:**
736 voters / 82 s at 4 workers, 3 with hits, lifecycle clean. **In flight overnight:**
Duval Tier 2 `--steps fl-contrib --concurrency 8` (146,129 eligible — first real Tier 2
yield measurement, the top ROADMAP item); record its result here when it completes.

**Alachua FEC re-run COMPLETE (ENH-002 done, 2026-07-06):** 40,374 re-processed in 29 min
(~23/s) → **+29 recovered leans: 178 → 207 settled at Tier 1** (146 Left / 61 Right),
yield **0.44% → 0.51%**, confirmed unchanged at 253 → conversion **82%** (vs Duval's 69% —
Gainesville donors more often give to party-identifiable committees). All Alachua evidence
timelines now carry itemized receipts (D-030 backfill). **Measured Tier-1 band, both
counties on the fixed pipeline: 0.32% (Duval) – 0.51% (Alachua).**

## Where to pick up (continuity note — 2026-07-06 FINAL, Duval post-DEF-005)

**DEF-005 re-pass complete — Duval Tier 1 FINAL: 470 settled (235 Left / 235 Right — a
dead-even split), yield 0.32%.** The unmatchable party-code regex (`\b` before `\(`, found
by the owner on rows 1619/3002) had left 85 confirmed donors Undetermined; the fixed-pattern
re-pass (146,214 unsettled voters, 1h47m at ~23/s) recovered all of them. Identity totals
unchanged (678 confirmed, 0.46%); confirmed→lean conversion now **69%** — matching
Alachua's 70%, i.e., the two counties now behave consistently and the pipeline's conversion
is stable. Measured Tier-1 band across two counties: **0.32% (Duval) – 0.44% (Alachua,
pre-fix)**; ENH-002 (Alachua re-run) should lift the top of the band. On a billed
engagement the DEF-005 recovery alone = 85 × $0.15 = $12.75 — small money, but 22% more
deliverable leans from one regex character.

## Where to pick up (continuity note — 2026-07-06, Duval Tier 1 RESULTS)

**Duval FEC index match COMPLETE** (upload `2036da1e`, snapshot `2024-fl`, all runs
post-D-030): **146,599 voters covered** → 678 identity-confirmed donors (0.46%) →
**385 settled at Tier 1** (200 Left / 185 Right / 0 Ind). **Tier-1 lean yield 0.26%** vs
Alachua's 0.44% (pre-D-030) — yield is county-dependent (Alachua/Gainesville NPAs donate
federally at a higher rate: 0.62% identity-confirmed vs Duval's 0.46%); treat the pitch
band as ~0.25–0.45% per single cycle loaded. Duval's donor split is near-even (52 L/48 R)
vs Alachua's 74/26 L — good research color. **Wall-clock:** final 8-way segment processed
134,099 voters in 1h37m (23/s sustained, zero stalls, keep-awake held); the full county at
final configuration ≈ 1h46m vs ~65 days on the API sweep (≈880×). arm_runs row completed
cleanly; dashboard current-inning strip retired itself on the final poll. **Next levers:**
backfill `indiv22`/`indiv20` (raises both counties' yield; settled voters skipped),
re-run Alachua post-D-030 (ENH-002), Tier 2 free pass on the ~146k remainder (mind Sunbiz
perf, ENH-001).

## Where to pick up (continuity note — 2026-07-05 latest+2, 8-way concurrency)

**ENH-004:** `run-fec-index.ts --concurrency N` (default 4, max 16) — the match was
latency-bound (sequential Neon round-trips from the operator Mac ≈ 2.6 voters/s), so N
workers on separate connections scale ~linearly. `runFecIndexChunk` was factored into
`claimFecIndexRows` + `processFecIndexVoter` (voter-scoped writes — parallel-safe across
distinct voters; the API route path is unchanged). Workers commit every ~10 voters;
heartbeat after each 500-row chunk; SIGINT/SIGTERM now mark the run `cancelled` in
arm_runs (kill -9 → 10-min reaper). **Measured on Duval: 22–23/s at 8 workers (~8.5×)** —
run restarted `--start-after 12499 --concurrency 8`, ETA ~1.6 h for the remaining ~133k.
Speed ladder for the record: API sweep ~0.026/s → index sequential ~2.6/s (100×) →
index 8-way ~22.5/s (865×). Next lever if needed: run adjacent to Neon (us-east-1).

## Where to pick up (continuity note — 2026-07-05 latest+1, live run visibility)

**Box score Phase B core shipped mid-Duval (ENH-003, migration 014 applied to Neon):**
`arm_runs` + `lib/evidence/arm-runs.ts` (startArmRun claims the one-active-run slot per
(upload, arm) via partial unique index, reaps stale runs at 10-min heartbeat age;
heartbeat = absolute cumulative counts ≥1×/chunk), `summary.runs` = arm_runs ∪
fec_sweep_jobs normalized at read (adapt-not-dual-write; degrades gracefully pre-014),
current-inning strips in the pinned box score (progress bar, rate, ETA, heartbeat age,
`CLI` chip, stalled at >5 min), uploads-list pulsing live dot, and the FEC index CLI
instrumented (+ `--start-after N` to continue a partial pass without re-touching rows).
The idle 30s poll discovers CLI runs with no UI action. **Duval run restarted instrumented**
with `--start-after` at its prior position — watch it live on the dashboard. **Early D-030
yield signal:** at 10k voters, 38 identity-confirmed → 18 leans (pre-fix trajectory was
7 → 1 at 2k; confirmed→lean conversion ~14% → ~47%). **Remaining for full Phase B:**
instrument `match-fec-index` API action + free-pass (API + CLI, incl. the chunking refactor
with hoisted `loadFreePassContext` + a >5,000-row UI guard) — ENH-003 in BACKLOG.

## Where to pick up (continuity note — 2026-07-05 latest, FEC party fix mid-Duval)

**D-030 landed mid-run:** the owner spotted a confirmed Duval donor (row 113) whose timeline
showed receipts but not recipients — root cause was two-fold (committee-master party never
reached lean scoring; confirmed-no-lean events wrote zero recipient lines). Fixed in
`lib/fec/local-lookup.ts` (party folded into committee display name), `lib/fec/donation-lean.ts`
(labels source-neutral, DFL added), `lib/evidence/fec-events.ts` (itemized `$amt → committee
(party) · date` lines + `payload.receipts` in both FEC builders). The Duval index run was
**killed at ~10k and restarted on the fixed code** — upsert (`DO UPDATE`) + claim-predicate
(skips only the 12 settled) means the first ~10k rewrite in place (~50 min redo), then the
run continues; expect **higher Tier-1 yield** than the pre-fix trajectory. Keep-awake is
active (built into the CLI as of `e9b9a15`; lid-close still sleeps — resume with the same
command if needed). **When the run completes:** record the final funnel + wall-clock below,
compare yield to Alachua's 0.44%, and consider **re-running Alachua** (skips its 178
settled) to enrich its events + re-measure yield with the party fix.

## Where to pick up (continuity note — 2026-07-05 later, Duval + county-scale ingest)

**County-scale ingest CLI shipped (`scripts/ingest-extract.ts`):** the Duval file (115 MB,
710,795 rows) can't go through the dashboard — Vercel caps request bodies at ~4.5 MB (the
31 MB Alachua file only ever worked via local dev, same Neon). The failed browser attempt
left **nothing** in the DB (single-transaction rollback). The CLI reuses the route's exact
parse/filter/hash/insert (extracted to `lib/ingest/insert-voter-records.ts`, now shared by
both paths), commits every 2,000 rows with progress/rate/ETA, holds the upload at `pending`
until complete, and supports `--resume <upload-id>` (continues from last committed
row_index; parse order is deterministic). **Duval ingested:** upload
`2036da1e-6e15-49d4-93a4-718a5e744aae`, 146,599 NPA+Active rows in ~102 s (~1,430/s),
102,860 with history (DUV_H matched 648,506 summaries). Integrity verified: actual = 
row_count, distinct row_index = 146,599. **FEC index match started same session**
(`run-fec-index.ts`, snapshot `2024-fl`): early rate ~3/s (network-bound from operator Mac,
same as Alachua) → projected ~13–14 h for the county; at 2,000 voters: 177 with rows
(8.9%) · 7 identity-confirmed · 1 settled. Old API sweep at ~94/hr would have needed
**~65 days** — this run is the county-scale validation of D-028. Chunk-committed and
resumable; record final funnel numbers + wall-clock here when it completes. **Keep-awake
added same session** (`lib/cli/keep-awake.ts`, wired into all four long CLIs): idle sleep
held off automatically via `caffeinate -i -w <pid>`; lid-close still sleeps (resume covers
it). The in-flight Duval run was protected retroactively with a manual `caffeinate -i -w`. Watch it live
via the Duval line-score row (processed/hits tick on each poll); rate/ETA in-UI arrives
with Phase B (`arm_runs`).

## Where to pick up (continuity note — 2026-07-05, box-score dashboard Phase A)

**Box-score dashboard shipped (D-029, Phase A — no migration):** progress visibility
restructured around the owner's baseball metaphor. New: `components/box-score.tsx`
(**BoxScoreBar** — sticky pinned scoreboard: records in / leans settled / conflicted /
accepted / still in research, live chip + progress strip when a run is active; **LineScore**
— tier-ordered per-arm table: eligible-in (est.) → processed → identity hits → lean signals →
settled here), `components/use-evidence-summary.ts` (the **single** polling loop: 5s active /
30s idle / paused on hidden tab — the 30s idle poll is what will make CLI runs discoverable
in Phase B), `lib/box-score.ts` (pure builder). `UploadEvidenceSummary` extended: per-arm
`voters_touched/voters_confirmed/voters_with_lean/last_event_at`, `settled.by_arm`,
`waterfall.eligible_by_tier`, `fec_sweep.total_count` (`lib/evidence/ledger.ts` — same
indexed scans, no new tables). Deleted (anti-duplication): `buildPipelineScoreboard`,
`PipelineScoreboardPanel`, the workspace command-bar stats grid + arm badges, the waterfall
gate counts line (re-enroll buttons live on under "Waterfall controls"), and all three old
polling loops (page fec-sweep 5s, workspace summary 5s, FecSweepPanel 5s). Upload list rows
gained a mini-score line (settled · accepted · conflicted) via one LATERAL join in
`GET /api/uploads`. **Verified:** `tsc`/lint/build green; summary run read-only against Neon —
Alachua reconciles exactly (178 settled T1, arm fec; touched 40,552; confirmed 253 = 247
index + 6 sweep; eligible_remaining 40,374; `eligible_by_tier` {0:40552, 1:40552, 2:40374,
3:40374}) in ~573 ms for the 40k upload (operator Mac; faster from Vercel). **Next (Phase B,
migration 014):** `arm_runs` table + instrument all runners (API + CLI) per D-029 — apply 014
to Neon *before* pushing Phase B code; free-pass runner also gets chunking + a >5,000-row UI
guard in that phase. Owner smoke test of the new layout is the gate between phases.

## Where to pick up (continuity note — 2026-07-04 later, FEC bulk index)

**FEC bulk index shipped (D-028, migration 013):** Tier 1 moves from the throttled FEC API
sweep (observed on Alachua: ~94 rows/hr average, 4–18 day projection, stall windows from FEC
429/5xx backoff that also dropped idle-in-transaction Neon connections) to a **local bulk
index** — county-scale matching in minutes. Staged FL-only, most-recent-cycle-first per owner
decision. Pieces: `migrations/013_fec_indiv_index.sql` (`fec_contributions` + snapshot
`completed_at` gate), `lib/reference-data/import-fec-indiv.ts` + `scripts/import-fec-indiv.ts`
(resumable loader: autocommit batches, unique `(snapshot_id, sub_id)`, live progress written
into the snapshot row every 30 s), `scripts/fec-indiv-status.mjs` (check-anytime progress),
`lib/fec/local-lookup.ts` (last-first name keys, exact + indexed-prefix), `lib/evidence/
fec-events.ts#buildFecIndexEvidenceEvent` (same arm 'fec'/tier 1; source `fec_indiv_index`),
`lib/fec/run-index-upload.ts` (chunked runner, standard claim predicate), `scripts/
run-fec-index.ts` (county-scale CLI, per-chunk commits) and a dashboard **Match FEC (local
index)** button (≤5,000 voters; larger → CLI). Runbook: `docs/SETUP.md` §8. **Not yet run:**
migration 013 must be applied, then download/load the 2024 cycle (~30 min), then match
Alachua's remainder locally — the crawling API sweep can be cancelled once the index pass
lands. Verified: FEC file format against fec.gov docs (21 pipe-delimited cols, SUB_ID unique,
MMDDYYYY dates); `fecNameNorm` unit cases; `tsc` clean.

**RESULTS (same evening):** 2024-cycle load: **3,981,111 FL rows** in ~12 min (58.2M lines
scanned, 7 malformed; snapshot `2024-fl` READY). Alachua index match: **40,546 voters in
3h12m** (~3.5/s, network-bound from the operator Mac) → 4,186 with name-matching rows (10.3%)
→ **247 identity-confirmed donors** → **178 settled at Tier 1** (132 Left / 46 Right ·
includes 6 from the cancelled API sweep, which was stopped at 802 voters processed).
Tier 1 lean yield on a real NPA county: **0.44%** — recalibrate the pitch's illustrative
example (which assumed ~2% at Tier 1) once Tier 2/3 actuals exist. Old API sweep: cancelled
2026-07-04 22:28Z. Next: Tier 2 free pass on the ~40k remainder (mind Sunbiz perf, backlog),
and/or backfill `indiv22`/`indiv20` cycles to raise Tier 1 yield (re-run the match after —
settled voters are skipped automatically).

## Where to pick up (continuity note — 2026-07-04, pricing + review controls)

**⚠️ Deploy gate:** migration **011** must be applied to Neon **before** this session's code is
pushed — the updated arm claim queries reference `voter_lean_fusion.review_status` /
`research_status`, which don't exist until 011 runs
(`node scripts/apply-migrations.mjs migrations/011_initiation_and_review.sql`). **Applied to
Neon 2026-07-04.** Build is green locally; an Alachua FEC sweep was running in prod during this
session (old code keeps working either way — 011 is additive).

**Pricing decisions (owner-confirmed, see D-026):** the seeded rate card **is** the client
pricing (baseline $0.03 / T1 $0.15 / T2 $0.25 / T3 $0.33 + $0.05 attempt) plus a **$2,500
initiation fee**; stage-gate advancement (no per-arm file round-trips); settlement stops
research by default with researcher re-enroll on top.

**Shipped this session:**
- **Initiation fee** (migration 011, `chargeInitiation` in `lib/billing/ledger.ts`): new
  `initiation` ledger kind, once-per-account partial unique index, `rate_cards.initiation_usd`
  (seeded $2,500). Billed at account creation (checkbox, default on) or via the "Charge
  initiation fee" button on the Billing console account detail.
- **Researcher review controls** (migration 011, `/api/voters/[id]/review`,
  `/api/uploads/[id]/re-enroll`): **Accept lean** freezes a voter's deliverable values
  (`persistFusionForVoter` early-returns on `review_status='accepted'`), excludes them from all
  arm claim queries, and writes a `human_judgment` `lean_review` audit event; **Reopen** clears
  it and re-fuses; **Re-enroll** (single voter or cohort: confidence ≤ 70 / FEC-settled tier 1 /
  withdraw) lets settled voters re-enter later arms without re-billing. Claim predicate now:
  locked → never; re-enrolled → claim even if settled; default → unsettled only
  (`claimFecSweepRows`, `runFreePassForUpload`).
- **Waterfall gate strip** (evidence workspace): eligible-remaining count, accepted/re-enrolled
  counts, projected max next-arm spend per tier (`summary.waterfall` via
  `getUploadEvidenceSummary` + `resolveRates`), cohort re-enroll buttons with confirms.
- **Deliverable provenance** (`/api/export/[uploadId]/deliverable`): `LeanLink Source` now lists
  **all** contributing arms (settled/billed arm first), new `LeanLink Status` column
  (accepted/fused/provisional/conflicted/unresearched), evidence = top 3 headlines, and a new
  **`?format=audit`** export — one row per evidence event (arm, source, identity band, lean
  signal, headlines, URLs) for full provenance.

**Market/pricing research (2026-07-04, summarized in D-026 + COST-ESTIMATES):** setup fees
$1k–$5k standard; per-match $0.02–$0.03 (append) to $0.07–$0.20 (skip-trace per hit) to
$0.50–$2.00 (investigative); modeled-partisanship pricing is quote-only market-wide; FEC
itemized donors ≈1.4% of adults (2020 cycle) → per-lean revenue is small next to the baseline
fee on NPA lists.

**Validate in prod after deploy:** create a throwaway account with initiation checkbox on →
ledger shows one `initiation` −$2,500 row (button disappears, second charge no-ops) → accept a
fused voter → `✓` in the voter list, later arms skip them, deliverable Status = `accepted` →
re-enroll FEC-settled cohort → waterfall-gate counts move, no new tier charges for re-settles →
`?format=audit` download.

**Posture evolution (same day, D-027):** "research only" is now scoped to what it always
protected — the FL DOS registration extracts (use-restricted data). Client-supplied lists on
per-client accounts proceed commercially. Migration **012** makes the guardrail structural:
`fl_extract` uploads can never carry a billing `account_id` (CHECK constraint; the upload
route also never sets one — verified live: both FL test uploads are unbilled, only the
`test001` generic import carries an account). Isolation Track A ↔ Track B is inherent:
upload-scoped evidence/fusion/household + disjoint hash schemes. **Migration 012 applied to
Neon 2026-07-04 and verified in the catalog** (`voter_uploads_fl_extract_unbilled` present
with `CHECK (source_type <> 'fl_extract' OR account_id IS NULL)`). Schema is current through
**012**.

**Brand A/B (same day):** parallel **OnRecord** variants of both client docs
(`onrecord-pitch.html`, `onrecord-one-pager.html`) for the naming decision — identical design,
name-only swap, so the A/B tests the name and nothing else. These are **generated mirrors** of
the `leanlink-*` sources (sed command in `docs/README.md`) — edit the LeanLink file, regenerate,
never hand-edit the OnRecord copies. Footers on all four now read "…by Four Plums, LLC"
(replaces "Michael Plumb / BitPlum"). **Descriptor decided (owner-approved 2026-07-04):
"Voter lean intelligence"** is the category line in mastheads/footers/taglines across all four
client docs; Florida/NPA specificity stays in the body copy. Still open: the name itself —
LeanLink vs OnRecord (owner will pick from the parallel docs).

**Client pitch (same day):** new `leanlink-pitch.html` — 3-page print-ready client pitch (what it
is / deliverable + audit + stage gates / confirmed pricing with a 25k worked example ≈ $4.5k,
~$1.45 per lean all-in). Framing: **fully managed service** (Michael operates the system on the
client's behalf; spend gated at every stage — clients never risk an accidental 40k run).
`leanlink-one-pager.html` pricing reconciled to D-026 ($2,500 / $0.03 / $0.15 / $0.25 /
$0.33 + $0.05; monthly platform fee removed). Sample-output names are fictitious.

## Lint gate restored (2026-07-04)

`npm run lint` had been failing on every tree state ("nextCoreWebVitals is not iterable" —
the flat config spread `eslint-config-next`'s eslintrc-format exports directly), so the
typecheck → lint → build pre-push gate was running blind on lint. Migrated to the ESLint CLI
(`eslint .`, FlatCompat-loaded `next/core-web-vitals` + `next/typescript`; see D-025) and
fixed the 8 findings the working linter surfaced (1 `prefer-const` error, unused
vars/imports, redundant useEffect deps, one justified `<img>` disable for a data-URL
Street View image). Gate is green again: lint 0 warnings, `tsc --noEmit` clean, build clean.

## Where to pick up (continuity note — 2026-07-03, tiered/prepaid product)

**Shipped this session (build green; migrations 008/009 applied to Neon; billing engine
verified via `scripts/smoke-billing.ts`):** LeanLink now runs as the tiered, prepaid,
waterfall product the one-pager (`leanlink-one-pager.html`) sells.

- **Generic client intake** (`lib/generic-voter-list.ts`, `lib/intake/completeness.ts`):
  arbitrary CSV/TSV/paste/JSON with fuzzy headers, normalized to `ParsedFlVoterRecord` so
  every arm consumes it unchanged. Anchor gate = name + one of county/ZIP/address. No voter
  ID → `hashGenericVoter` (name+address+dob+county). Per-record completeness (thin/moderate/
  rich). New route `/dashboard/intake`; `sourceType=generic` branch in `POST /api/uploads`.
- **Waterfall settlement** (`lib/evidence/settlement.ts`): once an arm yields a confident
  lean (≥ `LEANLINK_SETTLE_THRESHOLD`, default 60) it settles the voter at the cheapest
  contributing tier and **all later arms skip it** (FEC claim, free-pass, batch worker
  work-sets). Sticky, set-once in `persistFusionForVoter`. Migration 008 `settled_*` cols.
- **Prepaid billing** (`lib/billing/*`, migration 009): `accounts` hold a balance;
  `billing_ledger` is the append-only money log; `rate_cards` (`default` + per-account
  overrides, editable, no redeploy). Charge points: **baseline** per accepted record,
  **tier fee** once per settled voter, **OSINT attempt** per paid run. APIs `/api/accounts`,
  `/api/accounts/[id]`, `/api/rate-cards`; UI `/dashboard/accounts` (create/deposit/invoice/
  ledger/rate editor). Scoreboard shows settled-by-tier + billed totals.

**Open decisions (reversible config):** OSINT hit currently bills attempt **+** tier-3 (set
`osint_attempt_usd=0` to bill tier-3 only). Provided-party is inert (no lean emitted) —
recommended treatment is "weak prior, arms still run," not pre-settle.

**Validate in prod:** create account → deposit → `/dashboard/intake` sample list billed to
it → run FEC/FL/OSINT → scoreboard "Settled by tier" + "Billed $…"; Billing console invoice
reconciles. Confirm settled voters are skipped by later arms (no new cost).

**Fix (same session):** `lib/fec/contributor-lookup.ts` now **retries transient FEC 5xx +
network errors** (was 429-only), so an intermittent FEC 502 no longer records a real donor as
a non-donor. Root-caused via `scripts/debug-fec.ts` — a known Calhoun donor (Dianne Foster,
4 FEC contributions) "missed" purely because FEC threw a 502 and the lookup aborted with no
retry. Rows that errored *before* this fix are cached as no-hit for their sweep job; re-run
FEC (fresh job) or re-ingest to pick them up.

**Background FEC retry (same session):** new cron `/api/cron/fec-retry` (every 5 min,
`vercel.json`) + `lib/fec/retry-failed.ts` + migration 010 (`retry_attempts`/`last_attempt_at`
on `fec_lookup_results`). Re-attempts rows still carrying an `api_error`, capped at 8 attempts
spaced ≥10 min, throttled, in each row's user context — a recovered hit flows into the evidence
ledger and settles/bills automatically. So a flaky-then-recovered FEC self-heals without a manual
re-run.

## Where to pick up (continuity note — 2026-06-30, pre-deploy)

**⚠️ Before you stop for validation:** local changes are **not on Vercel** until **`git commit` +
`git push origin HEAD:main`** (run `npm run build` first). Prod still serves commit `20bbc88` until
then. Neon migration **`007_committee_lean.sql` is already applied**; dashboard/API for committee
lean and updated free-pass logic require deploy.

**Built locally (unshipped):**
- `(REP)` / `(DEM)` committee parser (`lib/committee-lean/infer.ts`)
- Layer-2 lean when entity bridge is `probable` · fusion weight **0.55×** for `fl_contrib_entity`
- **Committee lean** — uncertain queue + researcher labels (`007`) + modal + per-voter quick label
- **Researcher tiebreaker** — Street View + human estimate (`human_judgment` arm)
- `scripts/audit-layer2.ts` — Calhoun layer-2 committee audit

**FL & Sunbiz match** (dashboard button; was labeled “Run free pass”) is **not** federal FEC.
Large counties may hit the serverless time limit on Vercel until we add a background worker; CLI
fallback: `npx tsx scripts/run-free-pass.ts --county CAL`.

**Validate after deploy:** Calhoun demo path unchanged · optional **Committee lean** button ·
re-run free pass for new parsers/payloads · row 280 may show layer-2 Right from `(REP)`.

## Where to pick up (continuity note — 2026-06-29, post–voter filters)

**Shipped to prod:** Evidence accumulator + Tier 0 free pass + **voter list filters** (`main` · commit
`20bbc88`). Neon indexes: FL contrib **14.2M** (`2008-2026`), Sunbiz **20.6M** (`2026q2-cor0…cor9`).
Calhoun FEC sweep + free pass complete.

**Calhoun proof (`CAL_20250812.txt`, 736 NPA+ACT):**
- FEC: 27 raw → **3 confirmed** (`FEC✓`) → **3 fused lean** (Foster Left 95%; Hatcher Right 95%; Curl Right 95%)
- Free pass: **429** Sunbiz · **26** FL layer-2 entity · **3** FL layer-1 person · **344** household
- **733** fused `Undetermined` — expected (identity without partisan committee text)

**Inspect in prod:** Upload → Evidence accumulator → left pane filter pills **FEC✓** / **Layer-2** /
**Sunbiz** (expect **3** / **26** / **429** on Calhoun). Arms badges: `FEC✓` · `L2` · `SB`.
Demo: FEC rows 273/402/569 (lean) → Layer-2 row 224 or 280 (Sunbiz→entity, Undetermined lean).
Sunbiz match feeds layer-2 in the same free pass; lean only when committee text is partisan.

**Next best (priority order):**
1. **Professor walkthrough** — use filters above; explain identity vs lean
2. **Layer-2 lean audit** — do any of 26 entity donations carry partisan committee names worth labeling?
3. **Sunbiz lookup perf** — free pass ~84 min / 736 voters; prefix or trigram index on `officer_name_norm`
4. **Apify-modular eval** — Alachua curated subset vs `grok-full` (paid depth on promising rows only)
5. **Scorecard Tier-A metrics** — donation/media/civic % separate from social %

Docs updated: `enrichment-pipeline.html`, `evidence-accumulator-pitch.html` (continuity + filter tables).

## Where to pick up (continuity note — 2026-06-29, morning)

**Evidence accumulator (D-023):** Multi-arm ledger (`evidence_events`), fusion (`voter_lean_fusion` →
`lean_results`), dashboard split-pane **Evidence accumulator** above **Research lab**. FEC sweep
writes events per voter; **Sync FEC → ledger** backfills completed sweeps. **Anchor profile**
(`lib/anchor/*`): name variants (Maria↔Marcia, email maiden) + co-address household index;
**Tier 0 Free Pass:** `006_reference_data.sql` — `fl_contributions` + `sunbiz_officers` bulk indexes;
import scripts; dashboard **Run free pass** (layer 2 entity donations). **ACT** = FL registration
status (active on rolls), not political engagement. Anchor profile; FEC; scorecard → ledger.
Migrations through `006`.

## Where to pick up (continuity note — 2026-06-28)

**Safe POC workflow (use this):** Upload ingests voters only (no Grok). Select an upload →
**Analyze** section: enter a **test subset** of row indices (defaults to ~7 curated rows/county),
pick a **test** (enrichment, scorecard, Street View exploratory, or **FEC contributor lookup**),
run. Full-file **Run Analysis Job** is **disabled** until we validate cost and quality
(`LEANLINK_ENABLE_BATCH_INFERENCE` unset = off).

**Latest architecture:** Four Grok enrichment modes — `grok-full` (social-first + x_search +
Tier-A OSINT), `apify-modular` (Apify Google Search + page crawl + Street View exploratory
→ Grok synthesize only), `modular-targeted`, `modular-synthesize`. **Plus** direct FEC Open API
lookup (`lib/fec/contributor-lookup.ts`, `POST /api/enrichment/fec`) — no Grok, structured
Schedule A hits for disambiguation eval. Grok is **not** replaced by Apify or FEC; each is a
testable arm.

**Dashboard (2026-06-28):** Analyze UI restructured — subset input, single test picker, pipeline
mode for enrichment/scorecard only. Removed compare-all-modes and Street View strict from UI
(strict mode still exists in API for now). Results preview shows **row index** column.

**Scorecard findings so far:**
- **Calhoun (~736 rows):** identity probable ~90–95%; social ~0%; lean labeled ~0%.
- **Alachua (~40,552 rows):** upload ingested; full job started once (10 rows) then
  **cancelled**; scorecard on 7 curated rows — social ~1/7; lean still sparse.
- **FEC via Grok `site:fec.gov`:** poor yield in limited tests — direct API lookup added to
  measure true hit rate (validation in progress).

**Open questions (next session):**
1. **FEC validation** — run FEC lookup on curated subset; record `rows_with_hits` and whether
   hits disambiguate identity or supply lean signals.
2. Run `apify-modular` on Alachua curated rows; compare `apify_runs` / `fetched_text_chars` vs
   `grok-full` on same subset.
3. Tune Apify actors (`GET /api/enrichment/apify-config`) and crawl URL filtering (prefer
   FEC/media over Facebook login walls).
4. Professor field validation for **exploratory Street View** (separate from OSINT lean).
5. Scorecard: add Tier-A hit-rate metrics (`donation|media|civic`) separate from social %.
6. Re-enable batch only after median $/voter and coverage targets are met.

**Key env (production):** `XAI_API_KEY`, `GOOGLE_MAPS_API_KEY`, `APIFY_API_TOKEN`,
optional `FEC_API_KEY` (falls back to `DEMO_KEY` locally) — do **not** set
`LEANLINK_ENABLE_BATCH_INFERENCE` until deliberate.

## Pipeline

| Area | Status | Notes |
|---|---|---|
| Google sign-in, single-user lockout | ✅ | `lib/auth.ts`, restricted to `ALLOWED_USER_EMAIL`. |
| Registration extract parsing (38-field) + NPA/Active filter | ✅ | `lib/fl-voter-registration.ts`. |
| Generic client-list intake (CSV/paste/JSON, anchor gate, completeness) | ✅ | `lib/generic-voter-list.ts`, `lib/intake/completeness.ts`, `/dashboard/intake`. |
| Waterfall settlement (skip settled voters in later arms) | ✅ | `lib/evidence/settlement.ts`, migration 008; threshold `LEANLINK_SETTLE_THRESHOLD`. |
| Prepaid billing (accounts, ledger, rate cards, charge points) | ✅ | `lib/billing/*`, migration 009, `/dashboard/accounts`; verified `scripts/smoke-billing.ts`. |
| Initiation (kickoff) fee — $2,500, once per account | ✅ | Migration 011, `chargeInitiation`; billed at account creation (checkbox) or console button. |
| Researcher review: accept (freeze) / reopen / re-enroll | ✅ | Migration 011, `/api/voters/[id]/review`, `/api/uploads/[id]/re-enroll`; claim queries honor locked/re-enrolled. |
| Waterfall gate (eligible remaining + projected next-arm spend) | ✅ | `summary.waterfall` in `getUploadEvidenceSummary`; strip + cohort re-enroll in evidence workspace. |
| Background FEC retry cron (heals transient failures) | ✅ | `lib/fec/retry-failed.ts`, `/api/cron/fec-retry`, migration 010. |
| Client deliverable export (input file + lean/confidence/source/status/evidence per row) | ✅ | `/api/export/[uploadId]/deliverable`; multi-arm Source, Status column, `?format=audit` per-event provenance export. |
| Voting-history extract parsing + turnout scoring | ✅ | `lib/fl-voter-history.ts`. |
| Upload → hash → batch ingest | ✅ | `app/api/uploads`, `lib/hash.ts`. No Grok on upload. |
| County-scale ingest CLI (chunked, resumable) | ✅ | `scripts/ingest-extract.ts` + shared `lib/ingest/insert-voter-records.ts`; Duval 146,599 rows ≈ 102 s. Dashboard path caps at Vercel ~4.5 MB body limit. |
| Job runner: claim/process/heartbeat, self-chaining worker | ✅ | Gated by `lib/batch-inference.ts`. |
| Cron sweeper (stall recovery) | ✅ | Skips re-trigger when batch inference disabled. |
| Job cancel / upload delete | ✅ | `app/api/jobs/[id]/cancel`, `app/api/uploads/[id]`. |
| **Full-file batch inference** | 🟡 | Code exists; **disabled by default** (D-020). |
| Results dashboard: sort, filters, row index, hash+reveal | ✅ | `row_index` from `voter_records` in preview. |
| Box-score progress UI (pinned scoreboard, line score, unified poll) | 🟡 | Phase A shipped (D-029): `components/box-score.tsx`, `use-evidence-summary.ts`, `lib/box-score.ts`. Phase B (arm_runs live progress incl. CLI, migration 014) pending. |
| CSV / JSON export | ✅ | `app/api/export/[uploadId]`. |
| Turnout & opposition-mobilization scoring | ✅ | Real math in `lib/inference.ts`. |
| Grok live-search OSINT + lean inference | ✅ | `lib/enrichment/grok-pipeline.ts` + `inferLean` when `XAI_API_KEY` set. |
| Enrichment modes (4) | ✅ | `grok-full`, `apify-modular`, `modular-targeted`, `modular-synthesize`. |
| Analyze UI: subset + test picker | ✅ | `app/dashboard/page.tsx`, `lib/test-row-indices.ts`. |
| Enrichment test + scorecard APIs | ✅ | `POST /api/enrichment/test`, `scorecard` accept `rowIndices`. |
| FEC direct contributor lookup (subset) | ✅ | `POST /api/enrichment/fec` — 0/7 on curated Calhoun validation. |
| FEC whole-file sweep (batch, Open API) | ✅ | Calhoun 736/736; now the **fallback** path — throttled ~450/hr max, days at county scale. |
| FEC bulk index (local Tier 1, D-028) | 🟡 | Code shipped (migration 013, loader, status script, lookup, runner, dashboard button); **awaiting first data load** (SETUP §8). |
| Tier 0 Free Pass (FL + Sunbiz indexes) | ✅ | Indexes in Neon; Calhoun run; multi-shard Sunbiz lookup. |
| Free pass CLI | ✅ | `scripts/run-free-pass.ts --county CAL`. |
| FEC identity scoring + disambiguate | ✅ | `lib/fec/identity-match.ts`, `donation-lean.ts`, `fec-disambiguate`. |
| Evidence accumulator + fusion | ✅ | `005_evidence_ledger.sql`, `lib/evidence/*`, Evidence workspace UI. |
| Evidence voter list filters (FEC✓, layer-2, Sunbiz) | ✅ | `evidence-workspace.tsx`, `GET .../evidence?list=1&fec=1` etc. |
| Tier-A OSINT query plan (donations, media, civic) | ✅ | `lib/enrichment/query-builder.ts` (Grok/Apify path). |
| Lean guardrails (signals in `identity_matches`) | ✅ | `applyInferenceGuardrails` — don't trust `lean_signals_found` alone. |
| Apify fetch layer (Google Search + web crawl) | 🟡 | `lib/apify/*`, `apify-modular` — actors need live eval. |
| Street View vision (exploratory in UI) | 🟡 | `lib/google/street-view.ts`, `street-view-vision.ts` — research arm, not merged into main lean. |
| Geo/precinct lean prior | ⬜ | Deferred per D-009. |
| Automated tests | ⬜ | None. See `docs/USE_CASES.md`. |

## Top of the backlog

### Product layer — next up (2026-07-04)
1. **Upload delete/archive UX** — a DELETE endpoint exists (`app/api/uploads/[id]`, wired in the
   dashboard), but we want a real **manage-uploads** experience: discoverable delete, plus a
   soft **archive** (hide without losing the ledger/billing history), ideally bulk. Consider an
   `archived_at` column on `voter_uploads` and a filter on the uploads list.
2. **Name a pasted list** — generic pastes are stored as `filename = 'pasted-list'`. Add a
   "List name" input to `components/generic-intake.tsx` (the route already accepts `filename`),
   so uploads are identifiable in the inventory + deliverable filename.
3. **OSINT charge policy decision** — confirm whether an OSINT hit should bill attempt **+**
   tier-3 (current) or tier-3 only (`osint_attempt_usd = 0`). Money-sensitive; owner call.
4. **Party-prior decision** — provided party is currently inert (no lean emitted). Recommended:
   emit a low-weight tier-0 prior the arms confirm/override, never billed for echoing. Owner call.
5. **FL-scoped FEC bulk-load** — ✅ **shipped 2026-07-04 (D-028, migration 013)**; remaining:
   apply 013, load the 2024 cycle (SETUP §8), backfill older cycles, then retire the Alachua
   API sweep in favor of the local pass.
6. **HTML artifact redraw** — `enrichment-pipeline.html` / `evidence-accumulator-pitch.html` have
   2026-07-04 catch-up banners but still frame the research-POC; give them a billing/waterfall-aware pass.
   *(Partially addressed 2026-07-04: new client-facing `leanlink-pitch.html` (3-page, print-ready,
   confirmed pricing, managed-service framing) is now the flagship; `leanlink-one-pager.html`
   pricing reconciled to D-026 — the two internal spec HTMLs still need their pass.)*

### Research POC
1. **Professor demo** — Calhoun walkthrough via filter pills (FEC✓ 3 rows, Layer-2 26 rows).
2. **Layer-2 lean yield** — review 26 Calhoun entity donations for partisan committee labeling.
3. **Sunbiz index perf** — speed up `lookupSunbizOfficersForVoter` for county-scale free pass.
4. **Apify-modular eval** — Alachua curated subset; inspect actors and crawl quality.
5. **Scorecard Tier-A metrics** — donation/media/civic % alongside social %.
6. **Tests** — parsers, fusion, FEC/FL donation-lean, `buildResultsSql`.
7. **Batch re-enable criteria** — document $/voter + coverage thresholds before `LEANLINK_ENABLE_BATCH_INFERENCE`.

## Spec
- Doc index: [`docs/README.md`](README.md)
- Enrichment & inference pipeline: [`docs/enrichment-pipeline.html`](enrichment-pipeline.html)
- Design decisions: [`docs/DECISIONS.md`](DECISIONS.md)
- Cost bands: [`docs/COST-ESTIMATES.md`](COST-ESTIMATES.md)

## Known constraints / watch-items
- Requires Vercel **Pro** (worker `maxDuration = 800`) when batch is enabled.
- Grok ≈ **$0.03/voter** at `grok-full` — never run 40k without explicit opt-in.
- FEC `DEMO_KEY` is rate-limited — set `FEC_API_KEY` in Vercel for production eval volume.
- Single-user only by design; `user_id` is the email everywhere.
- `voter_hash` uniqueness is per user — re-processing conflicts on `lean_results` insert.