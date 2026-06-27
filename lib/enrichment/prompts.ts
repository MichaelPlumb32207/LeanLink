import type { EnrichmentBundle } from '@/lib/enrichment/types';
import type { EnrichmentMode } from '@/lib/enrichment/modes';
import { buildSearchQueryPlan } from '@/lib/enrichment/query-builder';
import { regionalMediaContextLabel } from '@/lib/enrichment/regional-media';
import { flCountyLabel } from '@/lib/fl-counties';

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
- DONATIONS / ACTIVISM: FEC (fec.gov), Florida campaign finance (dos.myflorida.com), OpenSecrets — named contributions to candidates, PACs, or committees; public activism (petitions, rallies) with partisan context.
- LOCAL MEDIA: letters to the editor, op-eds, guest columns, named quotes in regional press — only count when the person is clearly the same voter (name + city/county).
- CIVIC / PROFESSIONAL: myfloridalicense.com, sunbiz.org, nonprofit officer listings, school board / commission / council service — lean only when role or quoted statement has explicit partisan/ideological content.

Record Tier-A hits in identity_matches with platform donation|media|civic. Put explicit ideological content in signals[].`;

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
    mode === 'modular-synthesize'
      ? 'You do NOT have live search tools.'
      : 'You have web_search AND x_search. Use x_search FIRST for X/Twitter username lookups from email_insights.username_variants before broad web_search.';

  const searchNote =
    mode === 'modular-synthesize'
      ? 'Base answers only on the provided bundle and planned queries.'
      : mode === 'modular-targeted'
        ? 'Use x_search + web_search but ONLY the provided query list. Maximum 4 tool calls total — prioritize: 1 social/x_search, 1 donations, 1 local media, 1 directory or civic.'
        : 'SOCIAL-FIRST, then Tier-A lean sources (donations, local media, civic filings), then directories.';

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

DONATIONS / ACTIVISM (Tier-A lean — FEC, FL finance, activism):
${plan.donations.map((q, i) => `  Dn${i + 1}. ${q}`).join('\n') || '  (none)'}

LOCAL MEDIA (Tier-A lean — regional press; ${mediaHint}):
${plan.local_media.map((q, i) => `  M${i + 1}. ${q}`).join('\n') || '  (none)'}

CIVIC / PROFESSIONAL (Tier-A lean — licenses, Sunbiz, boards):
${plan.civic_professional.map((q, i) => `  P${i + 1}. ${q}`).join('\n') || '  (none)'}

DIRECTORY (corroborate last):
${plan.directory.map((q, i) => `  D${i + 1}. ${q}`).join('\n') || '  (none)'}`;
}

export function buildUserPrompt(bundle: EnrichmentBundle, mode: EnrichmentMode): string {
  const contact = contactForPrompt(bundle);
  const queryPlan = formatQueryPlan(bundle);
  const xSearchTargets = bundle.email_insights.username_variants.slice(0, 6);
  const countyLabel = flCountyLabel(bundle.anchor.county_code);

  const searchSection =
    mode === 'modular-synthesize'
      ? `PLANNED OSINT QUERIES (not executed):
${queryPlan}

Without live search: identity_resolution_status should be "none" unless citing voter file only. lean must be Undetermined.`
      : mode === 'modular-targeted'
        ? `EXECUTE IN ORDER (max 4 x_search/web_search calls — social, then Tier-A, then directory):
${queryPlan}

Use x_search for these X username targets first: ${xSearchTargets.length ? xSearchTargets.join(', ') : 'N/A'}`
        : `MANDATORY SEARCH ORDER:
1. x_search: look up X/Twitter accounts for email_insights.username_variants${bundle.email_insights.possible_maiden_or_alias ? ` and maiden/alias "${bundle.email_insights.possible_maiden_or_alias}"` : ''}.
2. web_search: Facebook, Instagram, LinkedIn profiles using email local-part, phone, and name.
3. web_search: DONATIONS / ACTIVISM — FEC, Florida campaign finance, OpenSecrets, named contributions and public activism for "${bundle.anchor.name_full}" in ${countyLabel}.
4. web_search: LOCAL MEDIA — letters to the editor, op-eds, guest columns, named quotes in regional press (${regionalMediaContextLabel(bundle.anchor.county_code)}).
5. web_search: CIVIC / PROFESSIONAL — myfloridalicense.com, sunbiz.org, nonprofit officers, school board / commission service.
6. web_search: directories (floridaresidentsdirectory.com) to corroborate identity.

QUERY PLAN:
${queryPlan}

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