export type EnrichmentMode = 'grok-full' | 'modular-targeted' | 'modular-synthesize';

export const ENRICHMENT_MODES: { id: EnrichmentMode; label: string; description: string }[] = [
  {
    id: 'grok-full',
    label: 'Grok full (open search)',
    description: 'Agentic live web search — highest cost, current default.',
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

export function parseEnrichmentMode(value: string | undefined | null): EnrichmentMode {
  if (value === 'modular-targeted' || value === 'modular-synthesize' || value === 'grok-full') {
    return value;
  }
  return 'grok-full';
}