import type { EnrichmentBundle } from '@/lib/enrichment/types';
import { flCountyLabel } from '@/lib/fl-counties';
import { regionalMediaSiteClause } from '@/lib/enrichment/regional-media';

export interface SearchQueryPlan {
  /** Run first — social platforms, email usernames, x_search targets */
  social: string[];
  /** Email, phone, contact cross-reference */
  contact: string[];
  /** FEC, state campaign finance, activism records — lean signal sources */
  donations: string[];
  /** Letters, op-eds, named quotes in regional press */
  local_media: string[];
  /** DBPR licenses, Sunbiz, public office / board service */
  civic_professional: string[];
  /** Directories and voter-ID corroboration (last) */
  directory: string[];
  /** Flat list for prompts (social → contact → tier-A lean → directory) */
  ordered: string[];
}

function pushUnique(target: string[], seen: Set<string>, query: string) {
  const q = query.trim();
  if (!q || seen.has(q)) return;
  seen.add(q);
  target.push(q);
}

function buildDonationQueries(
  anchor: EnrichmentBundle['anchor'],
  seen: Set<string>,
  donations: string[],
) {
  const county = flCountyLabel(anchor.county_code);
  const name = anchor.name_full;

  pushUnique(donations, seen, `site:fec.gov "${name}" Florida`);
  pushUnique(donations, seen, `site:fec.gov "${name}" ${anchor.city}`);
  pushUnique(
    donations,
    seen,
    `"${name}" Florida campaign contribution OR donor OR "political committee"`,
  );
  pushUnique(
    donations,
    seen,
    `site:dos.myflorida.com "${name}" contribution OR committee`,
  );
  pushUnique(donations, seen, `site:opensecrets.org "${name}"`);
  pushUnique(
    donations,
    seen,
    `"${name}" ${county} (ActBlue OR WinRed OR "campaign finance")`,
  );
  pushUnique(
    donations,
    seen,
    `"${name}" ${anchor.city} Florida (petition OR rally OR protest OR activism)`,
  );
}

function buildLocalMediaQueries(
  anchor: EnrichmentBundle['anchor'],
  seen: Set<string>,
  local_media: string[],
) {
  const county = flCountyLabel(anchor.county_code);
  const name = anchor.name_full;
  const mediaSites = regionalMediaSiteClause(anchor.county_code);

  pushUnique(
    local_media,
    seen,
    `"${name}" ${anchor.city} Florida (letter OR "letter to the editor" OR opinion OR editorial OR commentary)`,
  );
  pushUnique(
    local_media,
    seen,
    `"${name}" "${county}" (${mediaSites})`,
  );
  pushUnique(
    local_media,
    seen,
    `"${name}" ${anchor.city} (school board OR commissioner OR council OR candidate)`,
  );
  pushUnique(
    local_media,
    seen,
    `"${name}" ${county} interview OR profile OR "guest column"`,
  );
}

function buildCivicProfessionalQueries(
  anchor: EnrichmentBundle['anchor'],
  seen: Set<string>,
  civic_professional: string[],
) {
  const county = flCountyLabel(anchor.county_code);
  const name = anchor.name_full;

  pushUnique(civic_professional, seen, `site:myfloridalicense.com "${name}"`);
  pushUnique(civic_professional, seen, `site:sunbiz.org "${name}" ${anchor.city}`);
  pushUnique(
    civic_professional,
    seen,
    `"${name}" ${county} (nonprofit OR "board of directors" OR trustee OR officer)`,
  );
  pushUnique(
    civic_professional,
    seen,
    `"${name}" ${anchor.city} Florida (HOA OR "chamber of commerce" OR rotary OR "civic club")`,
  );
  pushUnique(
    civic_professional,
    seen,
    `"${name}" ${county} ("planning board" OR "zoning" OR "public meeting" OR commissioner)`,
  );
}

/** Social-first OSINT search plan with Tier-A lean signal sources (no API cost). */
export function buildSearchQueryPlan(bundle: EnrichmentBundle): SearchQueryPlan {
  const { anchor, contact_on_file, email_insights } = bundle;
  const social: string[] = [];
  const contact: string[] = [];
  const donations: string[] = [];
  const local_media: string[] = [];
  const civic_professional: string[] = [];
  const directory: string[] = [];
  const seen = new Set<string>();

  const county = flCountyLabel(anchor.county_code);
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

  buildDonationQueries(anchor, seen, donations);
  buildLocalMediaQueries(anchor, seen, local_media);
  buildCivicProfessionalQueries(anchor, seen, civic_professional);

  pushUnique(directory, seen, `site:floridaresidentsdirectory.com ${anchor.voter_id}`);
  pushUnique(directory, seen, `"${anchor.name_full}" ${anchor.city} Florida`);
  pushUnique(directory, seen, `"${anchor.name_full}" ${county}`);

  const ordered = [
    ...social,
    ...contact,
    ...donations,
    ...local_media,
    ...civic_professional,
    ...directory,
  ];

  return {
    social,
    contact,
    donations,
    local_media,
    civic_professional,
    directory,
    ordered: ordered.slice(0, 28),
  };
}

/** @deprecated use buildSearchQueryPlan */
export function buildSearchQueries(bundle: EnrichmentBundle): string[] {
  return buildSearchQueryPlan(bundle).ordered;
}