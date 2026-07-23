# LeanLink — Operator user guide

Short paths for the person running the dashboard (smoke tests, demos, client handoffs).
Architecture and decisions live in `CLAUDE.md` / `DECISIONS.md`; this is the “what do I click?”
layer.

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

Generic **client lists** (no FL extract): `/dashboard/intake` — never bill FL-extract data
to an account (structural guardrail).

## Evidence workspace

1. Select an upload from the inventory.
2. **Box score** — records in / settled / conflicted / accepted; line score per arm.
3. Click an **inning** (FEC, FL contributions, OSINT) to expand actions and filter the voter list.
4. **Sunbiz** lives nested under FL contributions (identity enrichment).
5. **Download deliverable (CSV)** — client handoff file (D-042 layers 1–2).

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
| **Client deliverable** | Evidence workspace “Download deliverable” · `/api/export/{id}/deliverable` | Client (layers 1–2) |
| **Internal audit** | `…/deliverable?format=audit` | Operator only (layer 4) |
| Research lab CSV/JSON | Research lab buttons · `/api/export/{id}?format=csv` | Internal `lean_results` dump |

Do **not** email `format=audit` as the default client package (D-042).

## Researcher review

Per voter: **Accept** (freeze lean, stop arm claims) · **Reopen** · **Re-enroll** (settled
voter re-enters later arms without re-billing). Cohort re-enroll lives in waterfall controls.

## Billing console

`/dashboard/accounts` — prepaid accounts, deposits, rate cards, initiation fee. Only for
**client-supplied** lists (Track B). FL registration extracts never attach an `account_id`.

## Related docs

- Continuity / what’s built: `PROGRESS.md`
- Use-case tests: `USE_CASES.md` (UC-15 deliverable + T15.9–T15.14 precedence)
- Setup & migrations: `SETUP.md`
- Decisions: D-041 (universe), D-042 (disclosure), D-043 (uniqueness), D-044 (precedence)
