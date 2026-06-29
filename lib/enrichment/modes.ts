export type EnrichmentMode =
  | 'grok-full'
  | 'modular-targeted'
  | 'modular-synthesize'
  | 'apify-modular'
  | 'fec-disambiguate';

export const ENRICHMENT_MODES: { id: EnrichmentMode; label: string; description: string }[] = [
  {
    id: 'grok-full',
    label: 'Grok social-first + x_search',
    description:
      'Social first, then donations/FEC, local media, civic filings (Tier-A lean), directories last.',
  },
  {
    id: 'apify-modular',
    label: 'Apify fetch + Grok synthesize',
    description:
      'Apify Google Search + page crawl, Street View exploratory vision, then Grok synthesis (no live search).',
  },
  {
    id: 'modular-targeted',
    label: 'Modular targeted (≤3 searches)',
    description: 'Uses our query plan + capped Grok searches — lower cost test.',
  },
  {
    id: 'modular-synthesize',
    label: 'Modular synthesize (no search)',
    description: 'Grok inference only, no web search — cheap baseline.',
  },
];

export const FEC_DISAMBIGUATE_MODE = {
  id: 'fec-disambiguate' as const,
  label: 'FEC disambiguate',
  description:
    'Score FEC hits deterministically; Grok only when identity is ambiguous (~FEC hit rows only).',
};

export function parseEnrichmentMode(value: string | undefined | null): EnrichmentMode {
  if (
    value === 'modular-targeted' ||
    value === 'modular-synthesize' ||
    value === 'grok-full' ||
    value === 'apify-modular' ||
    value === 'fec-disambiguate'
  ) {
    return value;
  }
  return 'grok-full';
}