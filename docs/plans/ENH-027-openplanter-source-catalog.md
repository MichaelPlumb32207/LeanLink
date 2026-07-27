# ENH-027 — OpenPlanter assessment: source catalog + candidate indexes

**Status:** Parked (assessment complete 2026-07-27; no code shipped).  
**Priority:** P3 — resume when adding a new reference arm or operator source docs.  
**Source review:** [ShinMegamiBoson/OpenPlanter](https://github.com/ShinMegamiBoson/OpenPlanter) (MIT, ~2.1k★ as of review; Python agent + Tauri desktop; `v0.1.1` 2026-03).

## Why this exists

Someone built an “OSINT / public-records knowledge graph” (OpenPlanter). We evaluated it for LeanLink. **Verdict: do not integrate as a product dependency.** Steal patterns and one candidate data source; keep identity/fusion architecture as-is.

Full comparison lives in session notes; this plan is the **resume checklist** so a future session can pick up without re-reading the repo.

---

## Verdict (do not re-litigate)

| Question | Answer |
|----------|--------|
| Plug OpenPlanter into LeanLink? | **No** — agent workbench + source wiki, not a voter-lean evidence ledger |
| Use as runtime infra? | **No** — Python/desktop, non-xAI providers, weak ER vs our address gates |
| Use *with* LeanLink? | **Yes** — source-card template, evidence-chain prompt discipline, measure-first 990 (maybe LDA) |
| Best single idea | **IRS 990 officer/org layer** (same “public entity” lever as ENH-018 / ENH-021) |

### What OpenPlanter actually ships

- Recursive LLM investigation agent (file/shell/Exa; OpenAI/Anthropic/Ollama/etc. — **no xAI**)
- Data-source **wiki** (`wiki/template.md` + category cards) powering a NetworkX/Cytoscape **source cross-ref graph**
- Stdlib fetch scripts (FEC, Senate lobbying, ProPublica 990, USASpending, SEC, OFAC, Census…)
- Boston demo ER (MA OCPF × city contracts, rapidfuzz org names) — not production identity

### What LeanLink already does better

FEC multi-snapshot bulk index, FL contrib + Sunbiz with street corroboration (ENH-012/013), fusion/waterfall/arm_runs/box score, xAI default, measured OSINT re-scope (D-033/ENH-016).

### Explicit non-goals when resuming

- Vendoring OpenPlanter or embedding its agent  
- Cytoscape as a second progress spine (violates D-036 / D-037)  
- USASpending / pay-to-play / OFAC / EPA / OSHA / ICIJ as lean arms without a measured lean story  
- Porting their fuzzy ER (would regress DEF-007/008 / ENH-012 identity discipline)  
- Census ACS as geo lean prior (still D-009 deferred)

---

## Resume path (phased)

### Phase A — docs only (cheap; do first when picked up)

1. Create `docs/sources/` with OpenPlanter-style cards (copy structure from their `wiki/template.md`):
   - Summary · Access · Schema · Coverage · **Cross-reference keys** · Data quality · Acquisition (our CLI) · Legal · References  
2. Write cards for **existing** arms (content already partly in SETUP + CLAUDE data-source table):
   - FEC bulk indiv + committee master  
   - FL DOS campaign-finance contributions  
   - Sunbiz COR officers  
3. Write one **candidate** card: ProPublica IRS 990 (status: not implemented / measure-first). Optional: Senate LDA.  
4. Link from `docs/README.md` and ROADMAP “Additional reference indexes”.  
5. Optional: fold evidence-chain phrasing (claim → record → source → confidence tier) into OSINT / ENH-022 research-arm prompt notes — not a separate product surface.

**Done when:** operator can open one markdown card per live source and one for 990-as-candidate without reading OpenPlanter again.

### Phase B — measure-first probe (only if Phase A still looks good)

Same bar as ENH-017 / ENH-021: **measure before building an arm**.

1. Sample: Duval (or current research county) — mix of settled donors + un-corroborated Sunbiz officers + thin NPAs.  
2. Probe ProPublica Nonprofit Explorer API (`https://projects.propublica.org/nonprofits/api/v2`) for name+state/zip officer/org hits.  
3. Record:
   - Identity corroboration rate (found, not guessed — same hard rule as ENH-021)  
   - Lean-from-org-mission rate (501(c)(4) / clear partisan org only; bipartisan/neutral → Undetermined, mirror ENH-018)  
   - False-positive story (name collisions)  
4. Legal check: ProPublica Data Terms (attribution; no competing bulk redistrib) before any Neon bulk index.  
5. If yield is dead → **shelve** like ENH-017 (keep probe script if written; no arm).

**Done when:** written PROGRESS numbers + go/no-go on Phase C.

### Phase C — build only if Phase B clears

Norm for any new arm (ROADMAP): funnel metrics in `arm_runs` + golden fixture + data-source verification row in CLAUDE.

- Migration + `reference_snapshots` pattern (like FEC/FL/Sunbiz)  
- Import CLI (owner-gated bulk load; no Vercel serverless reload button — ENH-020 posture)  
- Identity via shared `lib/reference-data/address-match.ts` (never re-fork)  
- Evidence events + fusion wiring; box-score inning or enrichment nest (D-038)  
- Goldens + USE_CASES rows  

**Do not start Phase C on vibes.**

---

## Candidate sources (filtered)

| Source | Fit | Notes |
|--------|-----|--------|
| **ProPublica IRS 990** | **Best** | Semi-public officers/board; join name+address/zip; lean only from clear org ideology |
| Senate LD-1/LD-2 / LD-203 | Niche | Elite / public-facing lists; thin for anonymous NPAs |
| SEC EDGAR | Thin | Public companies only |
| USASpending | Low for lean product | Journalism / contractor–donor pattern, not NPA ideology |
| FEC bulk | Already ours | Keep local index |
| MA corporate / OCPF | Wrong state | Pattern = Sunbiz + fl_contrib (done) |
| Property deeds | Maybe identity only | Weak lean; PII optics; no solid OpenPlanter wiki entry |

---

## Optional side path (not product)

Export a small CSV of conflicted / interesting voters and investigate ad hoc in OpenPlanter desktop. Parallel research tool only — never a LeanLink dependency.

---

## Related LeanLink IDs

- ENH-018 / D-034 — Grok on public committees (public-entity lever)  
- ENH-021 — Sunbiz officer corroboration (measure-first cousin)  
- ENH-017 — shelved follow-graph (coverage probe pattern to copy)  
- ENH-016 / D-033 — T3 enrichment not settle; don’t re-search Tier 1–2  
- ENH-020 — reference freshness surface  
- ROADMAP “Additional reference indexes” / arm plug-in via `lib/evidence/arms.ts`  
- D-036 / D-037 — no second progress UI spine  

---

## When resuming — first commands / reads

```text
1. Read this plan + BACKLOG ENH-027 + ROADMAP “Additional reference indexes”
2. Skim OpenPlanter only if needed:
   - https://github.com/ShinMegamiBoson/OpenPlanter/blob/main/wiki/template.md
   - https://github.com/ShinMegamiBoson/OpenPlanter/blob/main/wiki/nonprofits/propublica-990.md
3. Start Phase A (docs) unless owner asks for a 990 probe immediately
```
