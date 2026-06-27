import type { EnrichmentBundle } from '@/lib/enrichment/types';

export interface SearchQueryPlan {
  /** Run first — social platforms, email usernames, x_search targets */
  social: string[];
  /** Email, phone, contact cross-reference */
  contact: string[];
  /** Directories and voter-ID corroboration (last) */
  directory: string[];
  /** Flat list for prompts (social → contact → directory) */
  ordered: string[];
}

function pushUnique(target: string[], seen: Set<string>, query: string) {
  const q = query.trim();
  if (!q || seen.has(q)) return;
  seen.add(q);
  target.push(q);
}

/** Social-first OSINT search plan (no API cost). */
export function buildSearchQueryPlan(bundle: EnrichmentBundle): SearchQueryPlan {
  const { anchor, contact_on_file, email_insights } = bundle;
  const social: string[] = [];
  const contact: string[] = [];
  const directory: string[] = [];
  const seen = new Set<string>();

  const usernames = email_insights?.username_variants ?? [];
  const maiden = email_insights?.possible_maiden_or_alias;

  for (const user of usernames.slice(0, 6)) {
    pushUnique(social, seen, `site:x.com ${user}`);
    pushUnique(social, seen, `site:twitter.com ${user}`);
    pushUnique(social, seen, `site:instagram.com ${user}`);
    pushUnique(social, seen, `site:facebook.com ${user}`);
    pushUnique(social, seen, `site:linkedin.com/in ${user}`);
  }

  if (contact_on_file.email) {
    pushUnique(social, seen, `"${contact_on_file.email}"`);
    pushUnique(contact, seen, `"${contact_on_file.email}" facebook OR instagram OR linkedin`);
  }

  for (const user of usernames.slice(0, 4)) {
    pushUnique(social, seen, `"${user}" ${anchor.city} Florida`);
  }

  if (maiden) {
    pushUnique(social, seen, `"${anchor.name_full}" ${maiden} ${anchor.city} FL`);
    pushUnique(social, seen, `site:facebook.com "${maiden}" ${anchor.city}`);
    pushUnique(social, seen, `site:linkedin.com/in "${maiden}" Florida`);
  }

  pushUnique(social, seen, `site:facebook.com "${anchor.name_full}" ${anchor.city}`);
  pushUnique(social, seen, `site:linkedin.com/in "${anchor.name_full}" Florida`);
  pushUnique(social, seen, `site:instagram.com "${anchor.name_full}" ${anchor.city}`);
  pushUnique(social, seen, `site:x.com "${anchor.name_full}" ${anchor.city}`);

  for (const phone of contact_on_file.phone_search_variants ?? []) {
    pushUnique(contact, seen, `${phone} facebook OR linkedin OR instagram`);
    pushUnique(contact, seen, phone);
  }

  if (contact_on_file.phone) {
    pushUnique(contact, seen, `"${contact_on_file.phone}" ${anchor.city}`);
  }

  pushUnique(directory, seen, `site:floridaresidentsdirectory.com ${anchor.voter_id}`);
  pushUnique(directory, seen, `"${anchor.name_full}" ${anchor.city} Florida`);
  pushUnique(directory, seen, `"${anchor.name_full}" Calhoun County FL`);

  const ordered = [...social, ...contact, ...directory];

  return {
    social,
    contact,
    directory,
    ordered: ordered.slice(0, 18),
  };
}

/** @deprecated use buildSearchQueryPlan */
export function buildSearchQueries(bundle: EnrichmentBundle): string[] {
  return buildSearchQueryPlan(bundle).ordered;
}