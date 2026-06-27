import type { EnrichmentBundle } from '@/lib/enrichment/types';
import type { EnrichmentMode } from '@/lib/enrichment/modes';
import { buildSearchQueries } from '@/lib/enrichment/query-builder';

const JSON_SCHEMA = `{
  "identity_resolution_status": "probable" | "ambiguous" | "none",
  "identity_best_match_score": 0.0 to 1.0,
  "identity_matches": [
    {
      "platform": "web|x|linkedin|facebook|directory|other",
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
  * identity_resolution_status = whether you found the RIGHT PERSON in public records/web (directories count).
  * lean = ideological label ONLY when identity_matches contain explicit ideological signals.
- Directory / property / voter-ID confirmations count toward identity — put them in identity_matches even if signals[] is empty.
- If identity probable but NO ideological signals: lean MUST be "Undetermined", lean_confidence <= 35, lean_signals_found = false.
- If multiple ambiguous personas: identity_resolution_status = "ambiguous"; lean usually Undetermined.
- Return ONLY valid JSON — no markdown fences.`;

export function buildSystemPrompt(mode: EnrichmentMode): string {
  const searchNote =
    mode === 'modular-synthesize'
      ? 'You do NOT have live web search. Base answers only on the provided bundle and planned queries.'
      : mode === 'modular-targeted'
        ? 'Use live web search but ONLY the provided query list, maximum 3 searches total.'
        : 'Use live web search to find public personas and signals.';

  return `You are LeanLink, a research-only political intelligence assistant for Florida NPA voters.

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

export function buildUserPrompt(bundle: EnrichmentBundle, mode: EnrichmentMode): string {
  const queries = buildSearchQueries(bundle);
  const contact = contactForPrompt(bundle);

  const searchSection =
    mode === 'modular-synthesize'
      ? `PLANNED OSINT QUERIES (not executed — no live search in this mode):
${queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Without live search you cannot confirm identity. Set identity_resolution_status to "none" unless the voter file itself is cited. lean must be Undetermined.`
      : mode === 'modular-targeted'
        ? `EXECUTE THESE SEARCHES IN ORDER (stop after 3 searches max; do not invent extra queries):
${queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Use phone_formatted and phone_search_variants when searching phone numbers.`
        : `Search for public online presence (directories, social, LinkedIn, X, public Facebook, local news).
Prioritize: voter ID on floridaresidentsdirectory.com, name+city+FL, phone/email if on file.
Use phone_formatted and phone_search_variants for phone searches.`;

  return `Research this Florida NPA voter, then return JSON.

VOTER ANCHOR:
${JSON.stringify(bundle.anchor, null, 2)}

CONTACT ON FILE:
${JSON.stringify(contact, null, 2)}

VOTING HISTORY (behavioral — NOT ideological):
${JSON.stringify(bundle.history, null, 2)}

BALLOT SCENARIO (context only):
ballot_favors: ${bundle.ballot_favors}

${searchSection}

Return JSON:
${JSON_SCHEMA}`;
}