import type { EnrichmentBundle } from '@/lib/enrichment/types';
import type { EnrichmentMode } from '@/lib/enrichment/modes';
import { buildSearchQueryPlan } from '@/lib/enrichment/query-builder';

const JSON_SCHEMA = `{
  "identity_resolution_status": "probable" | "ambiguous" | "none",
  "identity_best_match_score": 0.0 to 1.0,
  "identity_matches": [
    {
      "platform": "web|x|linkedin|facebook|instagram|directory|other",
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

const SHARED_RULES = `STRICT RULES:
- OSINT only. No commercial data brokers.
- NEVER use race, gender, or demographic stereotypes.
- Do NOT use precinct/district geographic priors for lean.
- Voter is NPA — party registration is not available.
- Voting history primary participation = engagement ONLY, not party lean.
- SEPARATE identity resolution from lean inference:
  * identity_resolution_status = whether you found the RIGHT PERSON (social profile OR directory).
  * Social profile match (facebook.com/..., x.com/..., linkedin.com/in/..., instagram.com/...) is HIGH value — prefer over directory when contact info aligns.
  * lean = ideological label ONLY when identity_matches contain explicit ideological signals in signals[].
- If identity probable via social/directory but NO ideological signals: lean MUST be "Undetermined", lean_confidence <= 35, lean_signals_found = false.
- If multiple ambiguous personas: identity_resolution_status = "ambiguous"; lean usually Undetermined.
- Return ONLY valid JSON — no markdown fences.`;

export function buildSystemPrompt(mode: EnrichmentMode): string {
  const toolNote =
    mode === 'modular-synthesize'
      ? 'You do NOT have live search tools.'
      : 'You have web_search AND x_search. Use x_search FIRST for X/Twitter username lookups from email_insights.username_variants before broad web_search.';

  const searchNote =
    mode === 'modular-synthesize'
      ? 'Base answers only on the provided bundle and planned queries.'
      : mode === 'modular-targeted'
        ? 'Use x_search + web_search but ONLY the provided query list. Maximum 4 tool calls total.'
        : 'SOCIAL-FIRST: search Facebook, X, LinkedIn, Instagram using email username variants and phone BEFORE directories.';

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
  return `SOCIAL (run first — use x_search for username variants on X):
${plan.social.map((q, i) => `  S${i + 1}. ${q}`).join('\n') || '  (none)'}

CONTACT:
${plan.contact.map((q, i) => `  C${i + 1}. ${q}`).join('\n') || '  (none)'}

DIRECTORY (corroborate last):
${plan.directory.map((q, i) => `  D${i + 1}. ${q}`).join('\n') || '  (none)'}`;
}

export function buildUserPrompt(bundle: EnrichmentBundle, mode: EnrichmentMode): string {
  const contact = contactForPrompt(bundle);
  const queryPlan = formatQueryPlan(bundle);
  const xSearchTargets = bundle.email_insights.username_variants.slice(0, 6);

  const searchSection =
    mode === 'modular-synthesize'
      ? `PLANNED OSINT QUERIES (not executed):
${queryPlan}

Without live search: identity_resolution_status should be "none" unless citing voter file only. lean must be Undetermined.`
      : mode === 'modular-targeted'
        ? `EXECUTE IN ORDER (social → contact → directory; max 4 x_search/web_search calls):
${queryPlan}

Use x_search for these X username targets first: ${xSearchTargets.length ? xSearchTargets.join(', ') : 'N/A'}`
        : `MANDATORY SEARCH ORDER:
1. x_search: look up X/Twitter accounts for email_insights.username_variants${bundle.email_insights.possible_maiden_or_alias ? ` and maiden/alias "${bundle.email_insights.possible_maiden_or_alias}"` : ''}.
2. web_search: Facebook, Instagram, LinkedIn profiles using email local-part, phone, and name — BEFORE directories.
3. web_search: directories (floridaresidentsdirectory.com) only to corroborate identity.

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