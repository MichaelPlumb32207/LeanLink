# ENH-019 — Guided Evidence Workbench (build plan)

> **STATUS UPDATE 2026-07-08:** Phase 1 (clickable innings + arm panels) shipped, plus the D-036
> scoreboard single-source cleanup. **Phase 2 (the guide rail, §3–§4.2 below) was built and then
> removed on the owner's screen-read — see D-037.** It duplicated the line score + ON BASE strip
> and its linear metaphor mis-signalled. Do NOT re-implement the guide rail; the §4.1 arm panels
> and §4.3 Review/Deliver work still stand. This spec is kept as the historical build record.

**Status:** PLANNED 2026-07-08 · written for hand-off to a builder model.
**Read first:** root `CLAUDE.md`, `docs/CLAUDE.md` (architecture + gotchas), this file.
**Prime directive for the builder:** this is a *presentation* refactor. You will not touch
scoring, fusion, settlement, billing, migrations, or any `lib/evidence/*` internals beyond
adding new **pure** builder modules. Zero new API routes. Zero new DB queries. Everything
you render already arrives in `UploadEvidenceSummary` from the existing single polling loop.

---

## 1. Product intent (what the owner asked for)

The dashboard already has the right *readout* — the pinned scoreboard + per-arm "line score"
(baseball box score, D-029). What it lacks is *navigation and guidance*:

1. **Clickable innings.** Clicking a row in the line score should expand a detail panel for
   that research arm — its funnel numbers explained, its run history, and the actions/options
   that belong to it (which are currently scattered in a separate "steps 1–5" button list
   below the table).
2. **A TurboTax-style guide rail.** A single spine that shows what's been done (with the
   measured result), where you are now, what's next and *why*, and what's optional. The user
   should never have to deduce the next move from raw numbers — the UI proposes it, one
   primary CTA at a time.

End state: scoreboard (unchanged) → guide rail (new, replaces the 5 step cards) → line score
with expandable arm panels (absorbs all the action buttons) → voter list/detail (unchanged).

---

## 2. Current state — file map (verified 2026-07-08)

| File | What it is today | Fate |
|---|---|---|
| `app/dashboard/page.tsx` | Page; owns `useEvidenceSummary` (single polling loop), renders `BoxScoreBar` then `EvidenceWorkspace` | Minor: no new state; untouched except maybe imports |
| `components/use-evidence-summary.ts` | THE polling loop (5s active / 30s idle / hidden-tab pause) | **Do not touch. Do not add other polling loops.** |
| `components/box-score.tsx` | `BoxScoreBar` (sticky scoreboard), `CurrentInning`/`RunStrip` (live runs), `LineScore` (innings table + "ON BASE" opportunities strip) | `LineScore` gains selection + expansion; opportunities strip moves to the guide rail in Phase 2 |
| `lib/box-score.ts` | Pure `buildBoxScore(summary)` → scoreboard/innings/supporting/opportunities | Unchanged (source of truth for guidance) |
| `components/evidence-workspace.tsx` | Monolith: pipeline strip + line score + waterfall re-enroll controls + steps 1–5 action buttons + FecSweepPanel + committee-manager modal + voter split-pane | Sheds the step list; gains `selectedArm` state + panels |
| `components/pipeline-scoreboard.tsx` + `lib/pipeline-status.ts` | The 5 step cards + `buildPipelineSteps`/`suggestNextStep` | **Deleted in Phase 2** (guide rail supersedes; carry the gating predicates into `lib/guidance.ts`) |
| `components/pipeline-step.tsx` | Step-number presentation helpers used by the old button list | Delete in Phase 2 **if** grep shows no remaining users |
| `components/fec-sweep-panel.tsx` | FEC API sweep start/import panel (step 3) | Moves inside the FEC arm panel (Phase 1), reframed as the fallback path |
| `components/committee-lean-manager.tsx` | Modal, v2 (source badges, edit/delete, re-fuse) | Unchanged; opened from more places |
| `components/residence-tiebreaker.tsx` | Expand/collapse pattern precedent | Unchanged; copy its disclosure pattern |

Key data shapes (all existing, in `lib/evidence/types.ts` and `lib/box-score.ts`):
`UploadEvidenceSummary` (`.arms`, `.fusion`, `.settled`, `.waterfall`, `.runs.active/.recent`,
`.committees`, `.fec_sweep`, `.billing`), `BoxScore` (`.scoreboard`, `.innings[]`,
`.supporting[]`, `.opportunities[]`), `BoxScoreInning` (`arm/label/tier/eligible_in/attempted/
identity_hits/lean_signals/settled_here/state`), `ArmRunSummary` (status/processed/heartbeat/
anomalies…), `InningState = 'not_run' | 'partial' | 'complete' | 'live'`.

Existing action wiring in `evidence-workspace.tsx` (to be *moved*, not rewritten):
- `POST /api/uploads/{id}/evidence` with `{action}` ∈ `match-fec-index` (≤5k-eligible guard),
  `match-fl-contrib`, `match-sunbiz-entity` (both 5,000-eligible guard) — plus the
  confirm-if-already-complete re-run prompt.
- `POST /api/uploads/{id}/fec-sweep` `{action:'start'|'import'}` — inside `FecSweepPanel`.
- `POST /api/uploads/{id}/re-enroll` (low-confidence / FEC-settled / withdraw).
- Committee manager modal open + `refuse_all` (150-voter inline guard lives server-side).
- OSINT has **no UI trigger by design** (owner-gated CLI with a hard dollar cap) — keep it that way.

---

## 3. Target UX

```
┌─ BoxScoreBar (sticky, unchanged) ─────────────────────────────────────────────┐
│ 146,599 RECORDS IN · 556 SETTLED · 0 CONFLICTED · 0 ACCEPTED · 146,043 IN RES │
└───────────────────────────────────────────────────────────────────────────────┘

┌─ GuideRail (Phase 2 — replaces the 5 step cards) ─────────────────────────────┐
│  ✓ Ingest ── ✓ FEC federal ── ● Committees (2) ── ○ FL contrib ── ○ Sunbiz    │
│  ── ◇ OSINT (optional) ── ○ Review ── ○ Deliver                               │
│ ┌───────────────────────────────────────────────────────────────────────────┐ │
│ │ NEXT UP · Committees — 249 voters are behind labeled committees awaiting  │ │
│ │ re-fusion; one click books those leans. 687 more committees are unlabeled.│ │
│ │ [ Re-fuse now ]  [ Label committees ]  [ See the FL contributors arm → ]  │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘

┌─ LineScore (Phase 1 — rows clickable) ────────────────────────────────────────┐
│ TIER ARM                IN(EST.)  PROCESSED  ID HITS  LEANS  SETTLED  STATE   │
│ T0 ▸ Party (provided)   146,599   —          —        —      —        NOT RUN │
│ T1 ▾ FEC donations      146,599   146,599    678      546    546      COMPLETE│
│ ┌──────────────────────────────────────────────────────────────────────────┐  │
│ │ FEC federal donations — Tier 1, the primary settle arm.                  │  │
│ │ Matches voters against the local FEC bulk index (all loaded cycles).     │  │
│ │ Funnel: 146,599 eligible → 146,599 processed → 678 identified donors     │  │
│ │        → 546 lean signals → 546 settled here.                            │  │
│ │ RUNS  ✓ completed · 146,599 processed · cli · 7/6 → 7/7  (anomalies: —)  │  │
│ │ ACTIONS  [ Match FEC (local index) ]   guard: ≤5,000 eligible inline     │  │
│ │          county scale → npx tsx scripts/run-fec-index.ts --upload …      │  │
│ │          ▸ API sweep (fallback / freshness spot-check)  [FecSweepPanel]  │  │
│ └──────────────────────────────────────────────────────────────────────────┘  │
│ T2 ▸ FL state contributions …                                                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

Interaction rules:
- Clicking an inning row toggles its panel (one open at a time; click again = collapse).
- Guide-rail stage click → selects/expands the corresponding arm row (scrolls into view), or
  opens the committee manager (Committees stage), or focuses review/deliver surfaces.
- The "current" stage banner shows exactly **one** recommended move plus its *why* — the
  TurboTax voice. While any arm is live, the banner shows the live run instead (no CTA).
- STATE badges keep their run-lifecycle meaning (DEF-010) — the panel *explains* it
  ("completed run; hit-only arm, low event count is expected"), never re-derives it.

---

## 4. Phase plan — three independently shippable commits

Ship order matters: Phase 1 is pure addition (lowest risk), Phase 2 does the
removal/replacement, Phase 3 is polish + the review/deliver stages. **One commit per phase,
each gated by `npx tsc --noEmit` → `npm run lint` → `npm run build`, each followed by the
living-docs pass (§9), each pushed alone to `main`.**

### Phase 1 — Selectable innings + Arm Detail Panels

New files:

1. **`lib/evidence/arm-details.ts`** — pure metadata registry, no fetches, no React.
   ```ts
   export interface ArmActionSpec {
     id: 'match-fec-index' | 'match-fl-contrib' | 'match-sunbiz-entity'
       | 'fec-sweep-panel' | 'open-committee-manager' | 'refuse-pending';
     label: string;
     kind: 'evidence-action' | 'embedded-panel' | 'modal' | 'opportunity';
     /** Inline eligibility guard; over it, render the CLI hint instead of the button. */
     maxEligibleInline?: number;          // 5000 for the three evidence actions
     cliHint?: string;                    // county-scale command template
   }
   export interface ArmDetailSpec {
     arm: string;                         // matches BoxScoreInning.arm
     role: string;                        // one-liner: what this arm is for
     explainer: string;                   // 2–3 sentences, honest measured framing (§6 copy deck)
     hitOnly?: boolean;                   // Sunbiz: low event counts are by design
     actions: ArmActionSpec[];            // empty for party_prior / osint
     cliOnly?: { command: string; note: string };  // OSINT
   }
   export const ARM_DETAILS: Record<string, ArmDetailSpec> = { /* §6 */ };
   ```
2. **`components/use-evidence-actions.ts`** — extract (move, don't rewrite) the existing
   `runEvidenceAction` machinery out of `evidence-workspace.tsx` into a hook:
   `useEvidenceActions(uploadId, refreshSummary)` → `{ runAction, busyAction, notice, error,
   confirmLongRerun }`. The workspace's existing buttons switch to the hook in this phase so
   there is exactly one implementation; behavior byte-for-byte identical (same endpoints,
   same guards, same confirm prompt).
3. **`components/arm-detail-panel.tsx`** — `ArmDetailPanel({ arm, inning, summary, uploadId,
   actions, onOpenCommitteeManager, onImported })`. Renders, top to bottom:
   - role line + explainer (from `ARM_DETAILS`);
   - **funnel sentence** built from the `BoxScoreInning` (eligible → processed → ID hits →
     lean signals → settled), with the hit-only caveat when `hitOnly`;
   - **run history**: `summary.runs.active` (reuse `RunStrip`) + `summary.runs.recent`
     filtered to this arm — status chip, processed/total, hits/confirmed, runner chip
     (CLI vs UI), started→completed, amber `anomalies` lines if present;
   - **actions**: buttons via the hook (disabled with reason while any `busyAction`), the
     CLI hint when over `maxEligibleInline` (use `summary.waterfall.eligible_remaining` as
     the eligibility number, same as today's guard), `FecSweepPanel` embedded for the FEC
     arm under a "Fallback: FEC API sweep (freshness spot-check)" disclosure, and the
     committee shortcuts (open manager / re-fuse pending, counts from `summary.committees`)
     on the FL-contrib arm.

Modified files:

4. **`components/box-score.tsx` → `LineScore`**: add optional props
   `{ selectedArm?: string | null; onSelectArm?: (arm: string | null) => void;
   renderDetail?: (arm: string) => ReactNode }`. Rows become buttons (`role="button"`,
   `aria-expanded`, chevron ▸/▾ before the arm label, `cursor-pointer hover:bg-white/5`,
   selected row `bg-white/5`); when selected, render one full-width row
   (`<tr><td colSpan={8}>{renderDetail(arm)}</td></tr>`) beneath it. LineScore stays
   presentation-only — the panel comes in via `renderDetail`.
5. **`components/evidence-workspace.tsx`**: own `selectedArm` state, pass it + the render
   prop into `LineScore`; leave the old step list in place this phase (both paths share the
   hook, so no double-implementation).

**Phase 1 acceptance:** clicking each of the 5 core rows expands/collapses its panel;
keyboard operable (Enter/Space, `aria-expanded`); FEC panel shows run history + both FEC
paths; Sunbiz panel shows the address-gate explainer; OSINT/party panels are informational;
no new polling; no summary number rendered that isn't sourced from `buildBoxScore`/`summary`;
gates green; old buttons still work.

### Phase 2 — GuideRail (the TurboTax spine)

New files:

1. **`lib/guidance.ts`** — pure, golden-testable. Consumes what already exists:
   ```ts
   import type { BoxScore } from '@/lib/box-score';
   import type { UploadEvidenceSummary } from '@/lib/evidence/types';

   export type StageId = 'ingest' | 'fec' | 'committees' | 'fl_contrib'
     | 'sunbiz' | 'osint' | 'review' | 'deliver';
   export type StageStatus = 'done' | 'live' | 'available' | 'blocked' | 'upcoming' | 'optional';
   export interface GuidanceStage {
     id: StageId;
     title: string;
     status: StageStatus;
     result?: string;      // when done: the measured outcome ("546 leans settled · 678 donors")
     why?: string;         // when current: one sentence of TurboTax rationale
     badge?: number;       // attention count (committees pending, conflicts)
     action?: { type: 'select-arm'; arm: string }
            | { type: 'open-committees' }
            | { type: 'focus-review' }
            | { type: 'download-deliverable' }
            | { type: 'cli'; command: string };
   }
   export interface Guidance { stages: GuidanceStage[]; current: GuidanceStage | null }
   export function buildGuidance(box: BoxScore, summary: UploadEvidenceSummary): Guidance
   ```
   Status rules (single source: `box.innings[].state` — never re-derive from event counts):
   | Stage | done | available | blocked/upcoming | notes |
   |---|---|---|---|---|
   | ingest | always (workspace implies an ingested upload) | — | — | result: "{records_in} voters ingested" |
   | fec | inning `complete` | inning `not_run` or `partial` (partial ⇒ "Resume" why-copy) | — | live ⇒ `live` |
   | committees | both opportunity counts 0 **and** fec done | any `box.opportunities` count > 0 | `upcoming` until fec has events | badge = refuse+label counts; CTA priority: re-fuse first |
   | fl_contrib | inning `complete` | fec done | `blocked` until fec done (why: "runs on the pool FEC couldn't settle") | |
   | sunbiz | inning `complete` | fl_contrib done | `blocked` until fl_contrib done | |
   | osint | inning `complete` ⇒ done-optional | never (CLI only) | — | always rendered `optional`; action = `{type:'cli'}` |
   | review | — (ongoing; render ✓ style when conflicted=0 & accepted>0) | conflicted>0 (badge, why: "resolve conflicts") **or** T1+T2 all done | `upcoming` otherwise | |
   | deliver | — | `leans_settled > 0` | `upcoming` | result line: "{labeled_count} labeled ({labeled_pct}%)" |

   `current` = the single **live** stage if any inning is live (banner shows the run, no CTA
   — same spirit as today's `suggestNextStep` returning null while running); otherwise the
   **first** stage in order whose status is `available`. This ordering is what makes the
   committee opportunities interrupt the tier cascade — cheap wins first.
2. **`scripts/smoke-guidance.ts`** — offline fixture test, exit-code CI-able, style of
   `scripts/smoke-golden-voters.ts` (synthetic fixtures ONLY — never real voter data). Build
   ~6 fixture `UploadEvidenceSummary` objects and pin: fresh upload ⇒ current=fec; fec live ⇒
   current=live-fec with no CTA; fec done + opportunities>0 ⇒ current=committees with
   re-fuse-first CTA; fec done + no opportunities ⇒ current=fl_contrib; everything done ⇒
   current=deliver; cancelled fec run ⇒ fec available with resume framing; fl_contrib blocked
   while fec not_run.
3. **`components/guide-rail.tsx`** — horizontal spine + current-stage banner.
   - Spine: numbered/checked chips joined by a line, reusing the step-card palette
     (emerald=done, amber ring=current, sky pulse=live, dim=upcoming/blocked, outline+◇=optional),
     `overflow-x-auto` on small screens.
   - Banner (below spine): `NEXT UP · {title}` + `why` + primary CTA button + secondary
     "See the {arm} inning →" link (selects the row). For `cli` actions render the command in
     a copyable `<code>` block instead of a button. For `live`, embed the existing `RunStrip`.
   - Props: `{ guidance, onAction: (a: GuidanceStage['action']) => void }` — dumb component,
     all dispatch in the workspace.

Modified files:

4. **`components/evidence-workspace.tsx`** — the removal pass:
   - Replace `PipelineFlowTrack` + the whole "steps 1–5" action-button section with
     `<GuideRail>`; delete the waterfall-controls block's old position (it moves into the
     Review stage panel in Phase 3 — until then keep it under a `<details>` "Waterfall
     controls (advanced)" disclosure so nothing is lost);
   - action dispatch: `select-arm` → `setSelectedArm` + `scrollIntoView`; `open-committees`
     → existing modal state; `download-deliverable` → existing CSV handler;
     `focus-review` → scroll to the voter pane (Phase 3 wires the conflict filter).
   - Move the "ON BASE" opportunities strip **out of `LineScore`** — the committees stage
     badge + banner now carry those numbers (render-once rule, D-029). `buildBoxScore`
     keeps returning `opportunities`; only the render location changes.
5. Delete `components/pipeline-scoreboard.tsx` and `lib/pipeline-status.ts`; delete
   `components/pipeline-step.tsx` only if `grep -r "pipeline-step" --include="*.tsx"` shows
   no remaining importers (check `generic-intake.tsx` and `fec-sweep-panel.tsx` before
   deleting). Remove `FecSweepPanel`'s now-dead `stepState/suggested` props if unused.

**Phase 2 acceptance:** `smoke-guidance.ts` green; the rail reproduces today's suggested-step
behavior on a mid-cascade upload (screenshot state: fec done ⇒ committees or fl_contrib
current); no live-poll regressions (still exactly one loop); the pipeline-cards look is gone;
`npm run build` green.

### Phase 3 — Review & Deliver stages + polish

1. **Review stage panel** (rendered when the Review stage is selected from the rail — a
   panel in the same slot as arm panels, or above the voter list): conflicted count with a
   one-click "Show conflicted voters" (sets the voter-list filter; the list endpoint already
   filters by arm/name — add a `fused=conflicted` query param to the **existing** voter-list
   GET if one doesn't exist; that is the only permitted API touch, no new routes), the
   re-enroll/withdraw waterfall controls (moved from the `<details>` stopgap), and the
   accepted-count recap ("accepted voters are frozen — re-fusion never drifts them").
2. **Deliver stage**: CTA triggers the existing CSV download; recap line from
   `box.scoreboard` (labeled %, by-lean split, billing total when present). Note ENH-011
   (versioned deliverable deltas) as out of scope.
3. Polish: mobile (rail scrolls horizontally, panels stack), all three themes
   (`.theme-matrix/red/blue`) eyeballed, empty states (fresh upload: every stage upcoming
   except current=fec), `prefers-reduced-motion`-safe (no new animations beyond the existing
   pulse), keyboard pass.

---

## 5. Hard guardrails (violating any of these is a do-over)

1. **One polling loop.** `useEvidenceSummary` at page level stays the only fetch-on-interval.
   Panels and rail are pure renders of `summary`/`buildBoxScore`/`buildGuidance`.
2. **Render numbers once.** Any count shown must come from `buildBoxScore`/`buildGuidance`/
   `summary` — never a second SQL path, never client-side re-derivation (D-029).
3. **STATE = run lifecycle** (DEF-010). Panels explain states; they never recompute them
   from event coverage.
4. **No OSINT run button.** T3 spends real money per voter and is owner-gated behind a
   dollar-capped CLI (`run-osint-cohort.ts`). The UI shows the command and the verdict copy,
   nothing more.
5. **Keep every existing guard**: ≤5,000-eligible inline guard on the three evidence
   actions (over ⇒ CLI hint), the 150-voter re-fuse inline guard (server-side, surface its
   message), confirm-before-rerun on complete arms.
6. **No migrations, no new routes**, one optional query param in Phase 3 only (§4.3.1).
7. **Tailwind only**, existing palette (emerald/amber/sky/violet on black, `/10–/50` opacity
   steps), theme CSS variables, kebab-case component files, no new dependencies (no headless
   UI libs — the ResidenceTiebreaker disclosure pattern is the precedent).
8. **No PII anywhere** — fixtures in `smoke-guidance.ts` are synthetic; never commit real
   extract data (`.gitignore` already blocks it).
9. **Deploy hygiene**: gates (`tsc` → `lint` → `build`) before every push; push each phase
   as one commit to `main` only; commit author must be a GitHub account email on the Vercel project.

---

## 6. Copy deck (use these; interpolate live numbers — never hardcode counts)

Honesty rule: this product's credibility is *measured* claims (see docs/ROADMAP "pitch
recalibration"). Copy states what an arm actually does and what "good" looks like, including
arms whose good output is zero settles.

- **party_prior (T0)** · role: "Party as provided at intake." · explainer: "Tier 0 is
  whatever lean the input file already carries. NPA extracts carry none by construction —
  this row exists so the waterfall's starting point is explicit." (no actions)
- **fec (T1)** · role: "Federal donations — the primary settle arm." · explainer: "Matches
  voters against the local FEC bulk index across all loaded cycles; itemized receipts become
  auditable lean evidence. Committee labels (human > agent > pattern) decide the lean of
  each recipient. This is where most settles come from." · actions: `match-fec-index`
  (primary, D-028), sweep panel as "Fallback: API sweep — freshness spot-check only." ·
  CLI hint: `npx tsx scripts/run-fec-index.ts --upload <id> --concurrency 8`
- **committees stage** · why-copy when re-fusions pending: "{n} voters sit behind committees
  you've already labeled — re-fusion books those leans in one click." · when only unlabeled:
  "{n} committees have no lean label; labeling the big ones converts confirmed donors stuck
  at Undetermined. Grok proposes, you confirm — bipartisan PACs stay Undetermined."
- **fl_contrib (T2)** · role: "Florida state contributions — person-name match." ·
  explainer: "Matches voter names against FL campaign-finance contributors. Identity gating
  is strict (name+address corroboration), so expect heavy evidence and few settles — measured
  ~0.005% settle on county scale. Its committee labels share the same namespace as FEC."
- **sunbiz (T2)** · role: "Business-officer identity enrichment." · explainer: "Finds voters
  who are corporate officers (Sunbiz), then bridges address-corroborated officers to their
  company's state donations. The street-address hard gate means matches without a
  corroborated address can never settle — a completed run with zero settles is the arm
  working as designed, not failing." · `hitOnly: true`
- **osint (T3)** · role: "Public-expression OSINT — enrichment, not settle." · explainer:
  "A paid Grok pass over public political expression (endorsements, activism, self-ID).
  Measured yield on direct leans is near zero — its value is persona linkage on voters other
  arms already surfaced. Public sources only; no brokers, no logged-in scraping. Runs from
  the CLI under a hard dollar cap." · cli: `npx tsx scripts/run-osint-cohort.ts --upload <id>
  --dry-run` + note: "always dry-run first; execution is owner-approved with --max-usd."
- **review stage** · why-copy: conflicted>0 ⇒ "{n} voters have arms disagreeing — a
  researcher tiebreak settles each in seconds." else ⇒ "Accept voters to freeze their
  deliverable values; accepted voters never drift on re-fusion."
- **deliver stage** · why-copy: "Export the evidence-backed CSV — every lean carries its
  receipts. {labeled} of {total} voters labeled ({pct}%)."
- Banner prefix is always `NEXT UP`; done-stage result lines use the measured-outcome voice
  ("546 leans settled · 678 donors identified"), never adjectives.

---

## 7. What NOT to build (scope fences)

- No wizard that *blocks* actions — TurboTax guidance is a recommendation layer; every arm
  stays directly reachable via its inning row (the owner is the power user).
- No per-arm settings/config UI, no pattern-registry editor (that's ENH-008-UI).
- No deliverable versioning/deltas (ENH-011), no upload archive UX (roadmap "Manage-uploads").
- No animation/transition framework; conditional render is the house style.
- No renaming of arms/tiers/metaphors — box-score language is an owner favorite.

---

## 8. Verification plan (builder runs all of it)

1. `npx tsc --noEmit` · `npm run lint` · `npm run build` — per phase, before each push.
2. `npx tsx scripts/smoke-golden-voters.ts --offline` — must stay green (you didn't touch
   scoring; if it reddens, you did).
3. `npx tsx scripts/smoke-guidance.ts` — new, Phase 2+.
4. Manual screen pass on `npm run dev` against a real upload (owner has Duval loaded):
   every inning row expand/collapse; rail states match the line score; committee CTA opens
   the manager; re-fuse CTA books and the badge shrinks on the next poll; STATE badges
   unchanged from before the refactor. The owner's screen-reads have caught a real defect in
   every prior UI wave (DEF-009/010/011) — ask for one before calling a phase done.

---

## 9. Living-docs pass (per phase, per the repo protocol)

- `docs/BACKLOG.md` — ENH-019 row: flip status per phase (🟡 phase N shipped → ✅ on Phase 3).
- `docs/PROGRESS.md` — scoreboard row if a phase changes what's built.
- `docs/ROADMAP.md` — move the item when it ships.
- `docs/USE_CASES.md` — on Phase 1 add **UC-21 "Guided workbench navigation"** with
  UC-21·H (click an inning → panel with funnel/runs/actions; guide rail proposes the same
  next step the old cards did) and edge cases (live run ⇒ no CTA; blocked tier shows why;
  hit-only arm copy; OSINT has no run button). Extend on Phases 2–3.
- `docs/CLAUDE.md` — update the "Progress UI is the box score" paragraph: guide rail +
  `lib/guidance.ts` + arm panels join the D-029 architecture; note the deleted
  `pipeline-status.ts`/`pipeline-scoreboard.tsx`.
- `docs/README.md`, `docs/SETUP.md`, `docs/DECISIONS.md` — likely "no change required"
  (confirm); add a D-035 decision entry only if the owner asks for rationale capture.
