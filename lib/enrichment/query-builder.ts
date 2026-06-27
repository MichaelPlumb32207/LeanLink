import type { EnrichmentBundle } from '@/lib/enrichment/types';

/** Deterministic OSINT search plan (no API cost). Used by modular-targeted mode. */
export function buildSearchQueries(bundle: EnrichmentBundle): string[] {
  const { anchor, contact_on_file } = bundle;
  const queries: string[] = [];

  queries.push(`"${anchor.name_full}" ${anchor.city} Florida`);
  queries.push(`"${anchor.name_full}" Calhoun County FL`);

  if (anchor.voter_id) {
    queries.push(`site:floridaresidentsdirectory.com ${anchor.voter_id}`);
  }

  if (contact_on_file.email) {
    queries.push(`"${contact_on_file.email}"`);
    const local = contact_on_file.email.split('@')[0];
    if (local) queries.push(`"${local}" ${anchor.city} Florida`);
  }

  for (const phone of contact_on_file.phone_search_variants ?? []) {
    queries.push(phone);
  }

  queries.push(`site:facebook.com "${anchor.name_full}" ${anchor.city}`);
  queries.push(`site:linkedin.com/in "${anchor.name_full}" Florida`);
  queries.push(`site:x.com "${anchor.name_full}" ${anchor.city}`);

  return [...new Set(queries)].slice(0, 10);
}