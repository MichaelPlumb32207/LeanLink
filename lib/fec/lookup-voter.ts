import { buildAnchorProfile } from '@/lib/anchor/profile';
import { parseEmailInsights } from '@/lib/enrichment/email-insights';
import { buildNameSearchVariants, fecQueryNames } from '@/lib/anchor/name-variants';
import {
  lookupFecContributions,
  type FecContributionHit,
  type FecContributorLookupResult,
  type FecMatchLevel,
} from '@/lib/fec/contributor-lookup';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export interface FecVoterLookupResult {
  lookup: FecContributorLookupResult;
  contributions: FecContributionHit[];
  match_level: FecMatchLevel | 'none';
  names_tried: string[];
  variant_used: string | null;
}

function dedupeContributions(hits: FecContributionHit[]): FecContributionHit[] {
  const seen = new Set<string>();
  const out: FecContributionHit[] = [];
  for (const c of hits) {
    const key = [
      c.contributor_name?.toLowerCase(),
      c.receipt_date,
      c.amount,
      c.contributor_zip,
      c.committee_name,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * FEC Schedule A lookup for a voter anchor: strict on canonical name, then spelling
 * variants, then state_only fallback. Hits are still scored against the file anchor.
 */
export async function lookupFecForVoter(
  record: ParsedFlVoterRecord,
  options?: { maxVariantNames?: number },
): Promise<FecVoterLookupResult> {
  const emailInsights = parseEmailInsights(record.email, record.name.full);
  const names = fecQueryNames(
    buildNameSearchVariants(record, emailInsights),
    options?.maxVariantNames ?? 3,
  );

  const state = record.residence.state || 'FL';
  const city = record.residence.city;
  const zip = record.residence.zip;

  let lastLookup: FecContributorLookupResult | null = null;
  let match_level: FecMatchLevel | 'none' = 'none';
  let variant_used: string | null = null;
  const contributions: FecContributionHit[] = [];

  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const strict = await lookupFecContributions({
      name,
      city,
      state,
      zip,
      matchLevel: 'strict',
    });
    lastLookup = strict;

    if (strict.contributions.length > 0) {
      contributions.push(...strict.contributions);
      match_level = 'strict';
      if (i > 0) variant_used = name;
      break;
    }
    if (strict.error) {
      return {
        lookup: strict,
        contributions: [],
        match_level: 'none',
        names_tried: names.slice(0, i + 1),
        variant_used: null,
      };
    }
  }

  if (contributions.length === 0) {
    const relaxed = await lookupFecContributions({
      name: names[0],
      state,
      matchLevel: 'state_only',
    });
    lastLookup = relaxed;
    if (relaxed.contributions.length > 0) {
      contributions.push(...relaxed.contributions);
      match_level = 'state_only';
    }
  }

  return {
    lookup: lastLookup ?? {
      query: {
        contributor_name: names[0] ?? record.name.full,
        contributor_state: state,
        contributor_city: city,
        contributor_zip: zip,
      },
      api_url: '',
      result_count: 0,
      contributions: [],
    },
    contributions: dedupeContributions(contributions),
    match_level: contributions.length > 0 ? match_level : 'none',
    names_tried: names,
    variant_used,
  };
}

/** Profile-aware alias for dashboard / tests that already build anchor profile. */
export function fecNamesFromRecord(record: ParsedFlVoterRecord): string[] {
  const profile = buildAnchorProfile(record, []);
  return profile.fec_query_names;
}