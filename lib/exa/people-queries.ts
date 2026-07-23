import type { ExaPeopleAnchor } from '@/lib/exa/types';

/**
 * Natural-language people queries. The people category does not support
 * domain/date filters — encode location in the query string only.
 *
 * Prefer **specific lookup** shapes (name + place). Avoid role-discovery
 * queries ("product managers in Jacksonville") which return strangers.
 */
export function buildPeopleLookupQueries(anchor: ExaPeopleAnchor): string[] {
  const first = anchor.firstName.trim();
  const last = anchor.lastName.trim();
  const full = anchor.fullName.trim() || [first, last].filter(Boolean).join(' ');
  const city = anchor.city.trim();
  const county = anchor.countyLabel?.trim();
  const state = (anchor.state ?? 'Florida').trim() || 'Florida';
  const employer = anchor.employerHint?.trim();

  const queries: string[] = [];
  const push = (q: string) => {
    const t = q.replace(/\s+/g, ' ').trim();
    if (t && !queries.includes(t)) queries.push(t);
  };

  if (full && city) {
    push(`"${full}" ${city} ${state}`);
  }
  if (full && county) {
    push(`"${full}" living in ${county} ${state}`);
  }
  if (full && !city && !county) {
    push(`"${full}" ${state}`);
  }
  if (employer && full && city) {
    push(`"${full}" at ${employer} ${city} ${state}`);
  }
  // Fallback without quotes if middle tokens are noisy
  if (first && last && city && queries.length < 2) {
    push(`${first} ${last} ${city} ${state}`);
  }

  return queries.slice(0, 3);
}
