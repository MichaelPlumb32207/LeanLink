import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import { summarizeVoterHistory } from '@/lib/fl-voter-history';
import { parseEmailInsights } from '@/lib/enrichment/email-insights';
import { normalizePhone, phoneSearchVariants } from '@/lib/enrichment/normalize';
import { buildAnchorProfile } from '@/lib/anchor/profile';
import type { AnchorProfile } from '@/lib/anchor/profile';
import type { EnrichmentBundle, HistoryContext } from '@/lib/enrichment/types';

export function historyToContext(summary: VoterHistorySummary): HistoryContext {
  return {
    turnout_propensity: summary.turnout_propensity,
    turnout_score: summary.turnout_score,
    primary_engagement: summary.primary_engagement,
    primary_count: summary.primary_count,
    general_elections_voted: summary.general_elections_voted,
    general_elections_available: summary.general_elections_available,
    last_vote_date: summary.last_vote_date,
  };
}

/**
 * Assembles the enrichment input bundle. Hard-excludes race/gender per D-010.
 */
export function buildEnrichmentBundle(
  record: ParsedFlVoterRecord,
  historySummary: VoterHistorySummary | null | undefined,
  ballotFavors: BallotFavors,
  anchorProfile?: AnchorProfile,
): EnrichmentBundle {
  const history = historyToContext(
    historySummary ?? summarizeVoterHistory(undefined, new Set()),
  );

  const residence = record.residence;

  return {
    anchor: {
      voter_id: record.voterId,
      name_full: record.name.full,
      city: residence.city,
      zip: residence.zip,
      precinct: record.precinct,
      county_code: record.countyCode,
    },
    residence_on_file: {
      line1: residence.line1,
      line2: residence.line2,
      city: residence.city,
      state: residence.state || 'FL',
      zip: residence.zip,
      full: residence.full,
      has_usable_address: Boolean(residence.line1?.trim() && residence.city?.trim()),
    },
    contact_on_file: {
      has_email: Boolean(record.email),
      has_phone: Boolean(record.phone),
      email: record.email,
      phone: normalizePhone(record.phone),
      phone_raw: record.phone,
      phone_search_variants: phoneSearchVariants(record.phone),
    },
    email_insights: parseEmailInsights(record.email, record.name.full),
    anchor_profile: anchorProfile ?? buildAnchorProfile(record, []),
    history,
    ballot_favors: ballotFavors,
  };
}