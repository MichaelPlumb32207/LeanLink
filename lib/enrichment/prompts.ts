import type { EnrichmentBundle } from '@/lib/enrichment/types';
import type { EnrichmentMode } from '@/lib/enrichment/modes';
import type { StreetViewContextSummary } from '@/lib/enrichment/types';
import type { FecContributionHit } from '@/lib/fec/contributor-lookup';
import type { FecIdentityMatchResult } from '@/lib/fec/identity-match';
import { buildSearchQueryPlan } from '@/lib/enrichment/query-builder';
import { regionalMediaContextLabel } from '@/lib/enrichment/regional-media';
import { flCountyLabel } from '@/lib/fl-counties';

export interface ApifyPromptContext {
  fetchedOsintText: string;
  streetViewContext: StreetViewContextSummary | null;
}

const JSON_SCHEMA = `{
  "identity_resolution_status": "probable" | "ambiguous" | "none",
  "identity_best_match_score": 0.0 to 1.0,
  "identity_matches": [
    {
      "platform": "web|x|linkedin|facebook|instagram|directory|donation|media|civic|other",
      "url": "https://...",
      "match_score": 0.0 to 1.0,
      "match_reasons": ["..."],
      "signals": ["ideological signals ONLY if present in public content"]
    }
  ],
  "lean": "Left" | "Right" | "Independent" | "Undetermined",
  "lean_confidence": 0 to 100,
  "lean_signals_found": true | false,
  "evidence": ["human-readable evidence strings"],
  "search_summary": "what you searched and found"
}`;

const TIER_A_LEAN_SOURCES = `TIER-A LEAN SIGNAL SOURCES (search these even when social profiles are absent):
- PUBLIC POLITICAL EXPRESSION: the person's own overt public political acts — endorsements, "I voted for / I support" statements, public activism (petitions, rallies, volunteering), self-identified ideology in their public posts, and which political accounts they publicly follow / repost.
- LOCAL MEDIA: letters to the editor, op-eds, guest columns, named quotes in regional press — only count when the person is clearly the same voter (name + city/county).
- CIVIC / PROFESSIONAL: myfloridalicense.com, sunbiz.org, nonprofit officer listings, school board / commission / council service — lean only when role or quoted statement has explicit partisan/ideological content.

DO NOT search FEC (fec.gov), Florida campaign finance (dos.myflorida.com), or OpenSecrets — political donations are already resolved deterministically upstream by cheaper arms; re-searching them here wastes effort and adds nothing.

Record Tier-A hits in identity_matches with platform media|civic (or the social platform). Put explicit ideological content in signals[].`;

const SHARED_RULES = `STRICT RULES:
- OSINT only. No commercial data brokers.
- NEVER use race, gender, or demographic stereotypes.
- Do NOT use precinct/district geographic priors for lean.
- Voter is NPA — party registration is not available.
- Voting history primary participation = engagement ONLY, not party lean.
- SEPARATE identity resolution from lean inference:
  * identity_resolution_status = whether you found the RIGHT PERSON (social profile, directory, OR Tier-A record naming this person in their city/county).
  * Social profile match (facebook.com/..., x.com/..., linkedin.com/in/..., instagram.com/...) is HIGH value — prefer over directory when contact info aligns.
  * Tier-A records (donation, media quote, civic filing) can confirm identity AND supply lean signals when signals[] contain explicit ideology.
  * lean = ideological label ONLY when identity_matches contain explicit ideological signals in signals[].
- If identity probable but NO ideological signals in any match: lean MUST be "Undetermined", lean_confidence <= 35, lean_signals_found = false.
- lean_signals_found MUST be false unless at least one identity_matches[].signals[] entry quotes explicit ideological content (paraphrase in signals[] — empty signals[] is not allowed when lean is labeled).
- Lean WITHOUT social is valid ONLY via Tier-A matches (donation|media|civic) with non-empty signals[] — never from directory/contact match alone.
- If multiple ambiguous personas: identity_resolution_status = "ambiguous"; lean usually Undetermined.
- Return ONLY valid JSON — no markdown fences.

${TIER_A_LEAN_SOURCES}`;

export function buildSystemPrompt(mode: EnrichmentMode): string {
  const toolNote =
    mode === 'modular-synthesize' || mode === 'apify-modular'
      ? 'You do NOT have live search tools.'
      : 'You have web_search AND x_search. Use x_search FIRST for X/Twitter username lookups from email_insights.username_variants before broad web_search.';

  const searchNote =
    mode === 'modular-synthesize'
      ? 'Base answers only on the provided bundle and planned queries.'
      : mode === 'apify-modular'
        ? 'Apify already executed Google queries and crawled top organic pages. Synthesize ONLY from FETCHED_OSINT_TEXT and STREET_VIEW_CONTEXT below — do not invent URLs or quotes not present in fetched text.'
        : mode === 'modular-targeted'
          ? 'Use x_search + web_search but ONLY the provided query list. Maximum 4 tool calls total — prioritize: 1 social/x_search, 1 public political expression, 1 local media, 1 directory or civic.'
          : 'SOCIAL-FIRST, then Tier-A lean sources (public political expression, local media, civic filings), then directories.';

  return `You are LeanLink, a research-only political intelligence assistant for Florida NPA voters.

${toolNote}
${searchNote}

${SHARED_RULES}`;
}

function contactForPrompt(bundle: EnrichmentBundle) {
  const c = bundle.contact_on_file;
  return {
    has_email: c.has_email,
    has_phone: c.has_phone,
    email: c.has_email ? c.email : undefined,
    phone_formatted: c.has_phone ? c.phone : undefined,
    phone_search_variants: c.has_phone ? c.phone_search_variants : undefined,
  };
}

function formatQueryPlan(bundle: EnrichmentBundle): string {
  const plan = buildSearchQueryPlan(bundle);
  const mediaHint = regionalMediaContextLabel(bundle.anchor.county_code);
  return `SOCIAL (run first — use x_search for username variants on X):
${plan.social.map((q, i) => `  S${i + 1}. ${q}`).join('\n') || '  (none)'}

CONTACT:
${plan.contact.map((q, i) => `  C${i + 1}. ${q}`).join('\n') || '  (none)'}

PUBLIC POLITICAL EXPRESSION (Tier-A lean — endorsements, activism, public posts; donations resolved upstream — do NOT search FEC/finance sites):
${plan.donations.map((q, i) => `  Ex${i + 1}. ${q}`).join('\n') || '  (none)'}

LOCAL MEDIA (Tier-A lean — regional press; ${mediaHint}):
${plan.local_media.map((q, i) => `  M${i + 1}. ${q}`).join('\n') || '  (none)'}

CIVIC / PROFESSIONAL (Tier-A lean — licenses, Sunbiz, boards):
${plan.civic_professional.map((q, i) => `  P${i + 1}. ${q}`).join('\n') || '  (none)'}

DIRECTORY (corroborate last):
${plan.directory.map((q, i) => `  D${i + 1}. ${q}`).join('\n') || '  (none)'}`;
}

export function buildUserPrompt(
  bundle: EnrichmentBundle,
  mode: EnrichmentMode,
  apifyContext?: ApifyPromptContext,
): string {
  const contact = contactForPrompt(bundle);
  const searchPlan = buildSearchQueryPlan(bundle);
  const queryPlanText = formatQueryPlan(bundle);
  const xSearchTargets = bundle.email_insights.username_variants.slice(0, 6);
  const countyLabel = flCountyLabel(bundle.anchor.county_code);

  const apifySection =
    mode === 'apify-modular' && apifyContext
      ? `APIFY FETCH RESULTS (already executed — your only web evidence):
Queries run: ${searchPlan.ordered.slice(0, 8).join(' | ')}

FETCHED_OSINT_TEXT:
${apifyContext.fetchedOsintText || '(no fetch text — treat as no web evidence)'}

STREET_VIEW_CONTEXT (exploratory vision — separate research arm, NOT proof of OSINT lean):
${apifyContext.streetViewContext ? JSON.stringify(apifyContext.streetViewContext, null, 2) : '(no street view — address missing, imagery unavailable, or API unconfigured)'}

Use Street View only as weak contextual hint for identity/lean when scene_summary or visible_signals align with fetched OSINT. Never label lean from Street View stereotypes alone — lean still requires explicit ideological signals in identity_matches[].signals[] from FETCHED_OSINT_TEXT.`
      : '';

  const searchSection =
    mode === 'apify-modular'
      ? apifySection
      : mode === 'modular-synthesize'
        ? `PLANNED OSINT QUERIES (not executed):
${queryPlanText}

Without live search: identity_resolution_status should be "none" unless citing voter file only. lean must be Undetermined.`
        : mode === 'modular-targeted'
        ? `EXECUTE IN ORDER (max 4 x_search/web_search calls — social, then Tier-A, then directory):
${queryPlanText}

Use x_search for these X username targets first: ${xSearchTargets.length ? xSearchTargets.join(', ') : 'N/A'}`
        : `MANDATORY SEARCH ORDER:
1. x_search: look up X/Twitter accounts for email_insights.username_variants${bundle.email_insights.possible_maiden_or_alias ? ` and maiden/alias "${bundle.email_insights.possible_maiden_or_alias}"` : ''}.
2. web_search: Facebook, Instagram, LinkedIn profiles using email local-part, phone, and name.
3. web_search: PUBLIC POLITICAL EXPRESSION — endorsements, "voted for"/"supports" statements, activism (petitions, rallies, volunteering), self-identified ideology, and publicly-followed/reposted political accounts for "${bundle.anchor.name_full}" in ${countyLabel}. Do NOT search FEC / campaign-finance sites — donations are resolved upstream.
4. web_search: LOCAL MEDIA — letters to the editor, op-eds, guest columns, named quotes in regional press (${regionalMediaContextLabel(bundle.anchor.county_code)}).
5. web_search: CIVIC / PROFESSIONAL — myfloridalicense.com, sunbiz.org, nonprofit officers, school board / commission service.
6. web_search: directories (floridaresidentsdirectory.com) to corroborate identity.

QUERY PLAN:
${queryPlanText}

x_search username targets: ${xSearchTargets.length ? xSearchTargets.join(', ') : 'none — use name+city on X'}`;

  return `Research this Florida NPA voter, then return JSON.

VOTER ANCHOR:
${JSON.stringify(bundle.anchor, null, 2)}

CONTACT ON FILE:
${JSON.stringify(contact, null, 2)}

EMAIL INSIGHTS (use for social username / maiden-name search):
${JSON.stringify(bundle.email_insights, null, 2)}

VOTING HISTORY (behavioral — NOT ideological):
${JSON.stringify(bundle.history, null, 2)}

BALLOT SCENARIO (context only):
ballot_favors: ${bundle.ballot_favors}

${searchSection}

Return JSON:
${JSON_SCHEMA}`;
}

const FEC_DISAMBIGUATE_JSON_SCHEMA = `{
  "identity_resolution_status": "probable" | "ambiguous" | "none",
  "identity_best_match_score": 0.0 to 1.0,
  "identity_matches": [
    {
      "platform": "donation",
      "url": "fec.gov receipt URL from FEC_ROWS",
      "match_score": 0.0 to 1.0,
      "match_reasons": ["..."],
      "signals": ["partisan signal from committee/candidate ONLY when same-person confirmed"]
    }
  ],
  "lean": "Left" | "Right" | "Independent" | "Undetermined",
  "lean_confidence": 0 to 100,
  "lean_signals_found": true | false,
  "evidence": ["..."],
  "search_summary": "which FEC row(s) match and any corroboration searched"
}`;

export function buildFecDisambiguateSystemPrompt(): string {
  return `You are LeanLink FEC identity disambiguation — research-only, Florida NPA voters.

You already have FEC Schedule A rows (FEC_ROWS) and deterministic identity scores (DETERMINISTIC_SCORES).
Your job is ONLY:
1. Decide which FEC contribution row(s), if any, are the SAME PERSON as the voter anchor.
2. If identity is probable for at least one row, infer lean from donation recipient (committee/candidate party).
3. Do NOT search for social profiles, media, or directories unless needed to break a tie on employer+city.

RULES:
- Prefer deterministic scores — override only with explicit corroboration from web_search (employer, city, occupation).
- Maximum 2 web_search calls — employer + city corroboration only.
- identity_matches MUST use platform "donation" and fec.gov URLs from FEC_ROWS.
- lean_signals_found requires probable identity AND explicit partisan recipient (WinRed/ActBlue, party-named committee, etc.).
- If no FEC row is the same person: identity_resolution_status = "none", lean = "Undetermined".
- Return ONLY valid JSON.

${TIER_A_LEAN_SOURCES}`;
}

export function buildFecDisambiguateUserPrompt(
  bundle: EnrichmentBundle,
  deterministic: FecIdentityMatchResult,
  contributions: FecContributionHit[],
): string {
  const contact = contactForPrompt(bundle);
  const scoredSummary = deterministic.contributions.map((s, i) => ({
    index: i,
    identity_score: s.identity_score,
    match_reasons: s.match_reasons,
    contributor_name: s.contribution.contributor_name,
    contributor_city: s.contribution.contributor_city,
    contributor_zip: s.contribution.contributor_zip,
    contributor_employer: s.contribution.contributor_employer,
    contributor_occupation: s.contribution.contributor_occupation,
    committee_name: s.contribution.committee_name,
    candidate_name: s.contribution.candidate_name,
    fec_url: s.contribution.fec_url,
  }));

  return `Disambiguate FEC contributions for this voter. Return JSON.

VOTER ANCHOR:
${JSON.stringify(bundle.anchor, null, 2)}

RESIDENCE ON FILE:
${JSON.stringify(bundle.residence_on_file, null, 2)}

CONTACT ON FILE (corroboration only):
${JSON.stringify(contact, null, 2)}

DETERMINISTIC_SCORES:
identity_band: ${deterministic.identity_band}
best_score: ${deterministic.best_score}
probable_same_person: ${deterministic.probable_same_person}

${JSON.stringify(scoredSummary, null, 2)}

FEC_ROWS (full — do not invent rows):
${JSON.stringify(contributions, null, 2)}

Return JSON:
${FEC_DISAMBIGUATE_JSON_SCHEMA}`;
}