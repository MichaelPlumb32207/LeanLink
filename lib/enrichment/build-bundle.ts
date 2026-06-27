import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import { summarizeVoterHistory } from '@/lib/fl-voter-history';
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
): EnrichmentBundle {
  const history = historyToContext(
    historySummary ?? summarizeVoterHistory(undefined, new Set()),
  );

  return {
    anchor: {
      voter_id: record.voterId,
      name_full: record.name.full,
      city: record.residence.city,
      zip: record.residence.zip,
      precinct: record.precinct,
      county_code: record.countyCode,
    },
    contact_on_file: {
      has_email: Boolean(record.email),
      has_phone: Boolean(record.phone),
      email: record.email,
      phone: record.phone,
    },
    history,
    ballot_favors: ballotFavors,
  };
}