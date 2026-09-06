# LeanLink — Operator user guide

Short paths for the person running the dashboard (smoke tests, exports).
Architecture and decisions live in `CLAUDE.md` / `DECISIONS.md`; this is the “what do I click?”
layer.

If the database compute is parked, sign-in/upload fail until you enable it —
`docs/SETUP.md` § “Park / unpark Neon compute”.

## Sign-in

Google OAuth; only `ALLOWED_USER_EMAIL` may enter. Everyone else is rejected at the callback.

## Upload a FL registration extract

1. Dashboard → choose **registration file** (+ optional `*_H_*` history).
2. **Universe** (step before/with upload):
   | Preset | Keeps | Typical use |
   |---|---|---|
   | **NPA research** (`npa-act`) | NPA + Active | Lean research (legacy default) |
   | **GOTV** | All parties + Active + Inactive | Mobilization / priority lists |
   | **Custom** | Multi-select parties & statuses | Fine-grained |
3. Upload. County files over ~4.5 MB: use CLI  
   `npx tsx scripts/ingest-extract.ts --file … --universe gotv --history …`  
   (see `SETUP.md` §9).

Generic **lists** (no FL extract): `/dashboard/intake` — never attach an `account_id` to
FL-extract data (structural guardrail).

## Evidence workspace

1. Select an upload from the inventory.
2. **Box score** — records in / settled / conflicted / accepted; line score per arm.
3. Click an **inning** (FEC, FL contributions, OSINT) to expand actions and filter the voter list.
4. **Sunbiz** lives nested under FL contributions (identity enrichment).
5. **Download deliverable (CSV)** — export with lean columns (D-042 layers 1–2).

## Lean conflict rule (party vs wallet) — smoke this

When registration party (DEM/REP) and public-evidence lean disagree, the **deliverable**
uses the upload’s **Lean conflict rule** (D-044). Fusion research rows are **not** rewritten.

| Setting | Client Lean column |
|---|---|
| **Wallet wins (default)** | Public donation / evidence lean |
| **Registration wins** | Party on the roll |
| **Conflict → Undetermined** | Withhold lean |

**Smoke path**

1. Open an upload that has at least one settled FEC/FL lean on a DEM or REP voter  
   (GOTV universe is easiest — many party-registered rows).
2. Evidence workspace → **Lean conflict rule** dropdown → leave **Wallet wins**.
3. Download deliverable CSV → find a row with party DEM/REP and a determinate LeanLink Lean.
4. Flip to **Registration wins** → re-download → same row’s Lean should flip to party prior when
   they disagreed.
5. Flip to **Conflict → Undetermined** → re-download → Lean = Undetermined on that tension.
6. **Accept** a voter in the UI → deliverable keeps the frozen fusion lean regardless of rule.

API equivalent: `PATCH /api/uploads/{id}` body `{ "lean_precedence": "wallet" }`  
(or `registration` / `conflict_undetermined`).

Offline unit canary (no DB): `npx tsx scripts/smoke-lean-precedence.ts`.

## Exports

| Export | URL / control | Audience |
|---|---|---|
| **Deliverable** | Evidence workspace “Download deliverable” · `/api/export/{id}/deliverable` | Layers 1–2 |
| **Multi-county run** | CLI `npx tsx scripts/export-campaign-run.ts --mode hits\|all` (local ops) | All counties in a campaign JSON |
| **Internal audit** | `…/deliverable?format=audit` | Operator only (layer 4) |
| Research lab CSV/JSON | Research lab buttons · `/api/export/{id}?format=csv` | Internal `lean_results` dump |

**Baseline history columns** (client deliverable; from `history_summary` when a `*_H_*` file matched):

| Column | Meaning |
|--------|---------|
| LeanLink Turnout Propensity | High / Medium / Low (blank if no history match) |
| LeanLink Turnout Score | 0–100 |
| LeanLink Has History | yes / no |
| LeanLink Generals Voted / On File | counts |
| LeanLink Primary Voter / Count | yes/no + count (not party lean) |
| LeanLink Last Vote Date | when known |
| LeanLink Vote Pattern | presidential_years_only · midterm_years_only · multi_cycle · no_generals · unknown |
| LeanLink Low/High Propensity | yes/no |
| LeanLink Presidential Years Only | yes if all GEN votes were presidential years |

Existing campaign uploads already have propensity/score from ingest. **Vote pattern** (presidential vs midterm) is stored on **new** history ingests; older rows may show `unknown` until re-ingested with history.

Do **not** treat `format=audit` as the default export (D-042) — it is operator-internal.

## Researcher review

Per voter: **Accept** (freeze lean, stop arm claims) · **Reopen** · **Re-enroll** (settled
voter re-enters later arms). Cohort re-enroll lives in waterfall controls.

## Related docs

- What’s built: `PROGRESS.md`
- Use-case tests: `USE_CASES.md` (UC-15 deliverable + T15.9–T15.14 precedence)
- Setup & migrations: `SETUP.md`
- Decisions: D-041 (universe), D-042 (disclosure), D-043 (uniqueness), D-044 (precedence)
