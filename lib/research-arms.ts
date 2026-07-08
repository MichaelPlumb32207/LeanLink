/**
 * Research arms — placeholder scaffold for the Tier-3 "research arms" concept
 * (owner, 2026-07-08): OSINT (T3) stays the parent inning, and beneath it live
 * T3a, T3b, … research passes where Grok performs a specific, defined
 * investigation (system + researcher, highly interactive). These are PLANNED
 * placeholders — no backend, no runs, no spend — a scaffold to build out as we
 * decide what each pass does. The first two carry example intents from the owner;
 * the rest are unassigned slots.
 */
export interface ResearchArmPlaceholder {
  id: string; // 't3a' … 't3f'
  label: string; // 'T3a' …
  title: string;
  description: string;
}

export const RESEARCH_ARMS: ResearchArmPlaceholder[] = [
  {
    id: 't3a',
    label: 'T3a',
    title: 'Persona → activity linkage',
    description:
      'Take individuals other arms already surfaced and ask Grok to tie them to public donations, movements, or activism.',
  },
  {
    id: 't3b',
    label: 'T3b',
    title: 'Non-obvious correlations',
    description:
      'Look for signals that don’t sit on the surface — e.g. a lifestyle or purchase pattern that correlates with a lean.',
  },
  { id: 't3c', label: 'T3c', title: 'Research pass C', description: 'Unassigned — to be defined.' },
  { id: 't3d', label: 'T3d', title: 'Research pass D', description: 'Unassigned — to be defined.' },
  { id: 't3e', label: 'T3e', title: 'Research pass E', description: 'Unassigned — to be defined.' },
  { id: 't3f', label: 'T3f', title: 'Research pass F', description: 'Unassigned — to be defined.' },
];
