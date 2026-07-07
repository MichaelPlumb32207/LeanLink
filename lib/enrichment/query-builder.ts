import type { EnrichmentBundle } from '@/lib/enrichment/types';
import { flCountyLabel } from '@/lib/fl-counties';
import { regionalMediaSiteClause } from '@/lib/enrichment/regional-media';

export interface SearchQueryPlan {
  /** Run first — social platforms, email usernames, x_search targets */
  social: string[];
  /** Email, phone, contact cross-reference */
  contact: string[];
  /**
   * Public political EXPRESSION (endorsements, activism, self-identified politics)
   * — the lean signal only OSINT can see. Donations proper (FEC / FL campaign
   * finance / OpenSecrets) are resolved deterministically upstream by the Tier-1
   * and Tier-2 arms and are NOT re-searched here. Field name kept for the payload
   * contract (`search_query_plan.donations`).
   */
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

function searchNamesFromBundle(bundle: EnrichmentBundle): string[] {
  const names = bundle.anchor_profile?.fec_query_names ?? [bundle.anchor.name_full];
  return [...new Set(names.filter(Boolean))].slice(0, 4);
}

/**
 * PUBLIC POLITICAL EXPRESSION — the lean signal only OSINT can see: a person's
 * overt public political acts (endorsements, "I voted for / I support",
 * activism, self-identified ideology in their own posts).
 *
 * Deliberately does NOT re-search FEC / FL campaign finance / OpenSecrets. Those
 * donation databases are already resolved deterministically by the Tier-1 (FEC
 * bulk index) and Tier-2 (FL-contrib) arms — re-hunting them here via web search
 * was slow, unreliable, and pure duplicated spend. The OSINT arm predated those
 * indexes and was never re-scoped; this is that re-scope (see CLAUDE.md).
 */
function buildPublicExpressionQueries(
  bundle: EnrichmentBundle,
  seen: Set<string>,
  expression: string[],
) {
  const { anchor } = bundle;
  const county = flCountyLabel(anchor.county_code);
  const name = anchor.name_full;
  pushUnique(
    expression,
    seen,
    `"${name}" ${anchor.city} Florida (endorses OR endorsement OR "voted for" OR "i support")`,
  );
  pushUnique(
    expression,
    seen,
    `"${name}" ${anchor.city} Florida (petition OR rally OR protest OR activism OR volunteer)`,
  );
  pushUnique(
    expression,
    seen,
    `"${name}" ${county} (conservative OR progressive OR Republican OR Democrat OR MAGA OR "resist")`,
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
  const public_expression: string[] = [];
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

  for (const altName of searchNamesFromBundle(bundle).slice(1, 3)) {
    pushUnique(social, seen, `site:facebook.com "${altName}" ${anchor.city}`);
    pushUnique(social, seen, `"${altName}" ${anchor.city} Florida`);
  }

  for (const member of bundle.anchor_profile.household_members.slice(0, 2)) {
    pushUnique(
      social,
      seen,
      `"${member.name_full}" ${anchor.city} Florida (same address household context)`,
    );
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

  buildPublicExpressionQueries(bundle, seen, public_expression);
  buildLocalMediaQueries(anchor, seen, local_media);
  buildCivicProfessionalQueries(anchor, seen, civic_professional);

  pushUnique(directory, seen, `site:floridaresidentsdirectory.com ${anchor.voter_id}`);
  pushUnique(directory, seen, `"${anchor.name_full}" ${anchor.city} Florida`);
  pushUnique(directory, seen, `"${anchor.name_full}" ${county}`);

  const ordered = [
    ...social,
    ...contact,
    ...public_expression,
    ...local_media,
    ...civic_professional,
    ...directory,
  ];

  return {
    social,
    contact,
    // Field name `donations` kept for the payload contract; contents are now
    // public political expression (see the interface + buildPublicExpressionQueries).
    donations: public_expression,
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