import type { EvidenceArmId } from '@/lib/evidence/types';

export interface EvidenceArmDefinition {
  id: EvidenceArmId;
  label: string;
  description: string;
  cost_tier: 'free' | 'paid' | 'math' | 'exploratory';
  default_enabled: boolean;
  sort_order: number;
}

/** Registry of evidence arms — add/remove per research effort (config later). */
export const EVIDENCE_ARMS: EvidenceArmDefinition[] = [
  {
    id: 'fec',
    label: 'FEC donations',
    description: 'Schedule A contributor lookup + deterministic identity scoring.',
    cost_tier: 'free',
    default_enabled: true,
    sort_order: 10,
  },
  {
    id: 'fl_contrib',
    label: 'FL state contributions',
    description: 'Bulk-indexed DOS campaign finance — person + entity (layer 2) lookups.',
    cost_tier: 'free',
    default_enabled: true,
    sort_order: 15,
  },
  {
    id: 'sunbiz',
    label: 'Sunbiz officers',
    description: 'Bulk-indexed corporate officer matches; bridges to entity donations.',
    cost_tier: 'free',
    default_enabled: true,
    sort_order: 16,
  },
  {
    id: 'osint',
    label: 'OSINT (Grok)',
    description: 'Social-first web search, Tier-A donations/media/civic in synthesis.',
    cost_tier: 'paid',
    default_enabled: true,
    sort_order: 20,
  },
  {
    id: 'local_media',
    label: 'Local media',
    description: 'Letters, op-eds, named quotes in regional press.',
    cost_tier: 'paid',
    default_enabled: false,
    sort_order: 30,
  },
  {
    id: 'civic',
    label: 'Civic / professional',
    description: 'Sunbiz, licenses, public board service.',
    cost_tier: 'paid',
    default_enabled: false,
    sort_order: 40,
  },
  {
    id: 'household',
    label: 'Household & aliases',
    description: 'Co-address registrants and name-variant expansion.',
    cost_tier: 'free',
    default_enabled: false,
    sort_order: 50,
  },
  {
    id: 'street_view',
    label: 'Street View',
    description: 'Exploratory vision — separate from fused OSINT lean (D-018).',
    cost_tier: 'exploratory',
    default_enabled: false,
    sort_order: 60,
  },
  {
    id: 'turnout',
    label: 'Voting history',
    description: 'Turnout and opposition mobilization — behavioral, not ideological.',
    cost_tier: 'math',
    default_enabled: true,
    sort_order: 70,
  },
];

export function armById(id: EvidenceArmId): EvidenceArmDefinition | undefined {
  return EVIDENCE_ARMS.find((a) => a.id === id);
}