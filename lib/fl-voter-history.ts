/**
 * Florida DOS Voting History Extract — tab-delimited, 5 fields, no header.
 * CAL_H_YYYYMMDD.txt
 */

export const FL_HISTORY_FIELD_COUNT = 5;
const VOTED_CODES = new Set(['Y', 'E', 'A']);

export type TurnoutPropensity = 'High' | 'Medium' | 'Low';
export type BallotFavors = 'south' | 'north';

export interface HistoryEvent {
  countyCode: string;
  voterId: string;
  electionDate: string;
  electionType: string;
  historyCode: string;
}

export interface VoterHistorySummary {
  total_events: number;
  general_elections_voted: number;
  general_elections_available: number;
  primary_elections_voted: number;
  last_vote_date: string | null;
  turnout_score: number;
  turnout_propensity: TurnoutPropensity;
  primary_count: number;
  primary_engagement: string;
}

function normalizeLine(line: string): string {
  return line.replace(/\r$/, '').replace(/\n$/, '');
}

export function parseHistoryLine(line: string): HistoryEvent | null {
  const normalized = normalizeLine(line);
  if (!normalized) return null;

  const row = normalized.split('\t');
  if (row.length !== FL_HISTORY_FIELD_COUNT) {
    throw new Error(`Expected ${FL_HISTORY_FIELD_COUNT} history fields, got ${row.length}`);
  }

  return {
    countyCode: row[0].trim(),
    voterId: row[1].trim(),
    electionDate: row[2].trim(),
    electionType: row[3].trim(),
    historyCode: row[4].trim(),
  };
}

function voted(code: string): boolean {
  return VOTED_CODES.has(code);
}

function turnoutBand(score: number): TurnoutPropensity {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

function formatPrimaryEngagement(count: number): string {
  if (count <= 0) return 'No';
  return count === 1 ? 'Yes (1 primary)' : `Yes (${count} primaries)`;
}

export function buildHistoryIndex(content: string): {
  byVoter: Map<string, HistoryEvent[]>;
  generalElectionDates: Set<string>;
} {
  const byVoter = new Map<string, HistoryEvent[]>();
  const generalElectionDates = new Set<string>();

  for (const line of content.split(/\r?\n/)) {
    const event = parseHistoryLine(line);
    if (!event) continue;

    if (!byVoter.has(event.voterId)) byVoter.set(event.voterId, []);
    byVoter.get(event.voterId)!.push(event);

    if (event.electionType === 'GEN') {
      generalElectionDates.add(event.electionDate);
    }
  }

  return { byVoter, generalElectionDates };
}

export function summarizeVoterHistory(
  events: HistoryEvent[] | undefined,
  generalElectionDates: Set<string>,
): VoterHistorySummary {
  if (!events || events.length === 0) {
    return {
      total_events: 0,
      general_elections_voted: 0,
      general_elections_available: generalElectionDates.size,
      primary_elections_voted: 0,
      last_vote_date: null,
      turnout_score: 0,
      turnout_propensity: 'Low',
      primary_count: 0,
      primary_engagement: 'No',
    };
  }

  const genVotedDates = new Set<string>();
  let primaryVoted = 0;
  let lastVoteDate: string | null = null;

  for (const event of events) {
    if (!voted(event.historyCode)) continue;

    if (event.electionDate && (!lastVoteDate || event.electionDate > lastVoteDate)) {
      lastVoteDate = event.electionDate;
    }

    if (event.electionType === 'GEN') {
      genVotedDates.add(event.electionDate);
    }
    if (event.electionType === 'PRI' || event.electionType === 'PPP') {
      primaryVoted += 1;
    }
  }

  const available = Math.max(generalElectionDates.size, 1);
  const turnoutScore = Math.round((genVotedDates.size / available) * 100);

  return {
    total_events: events.length,
    general_elections_voted: genVotedDates.size,
    general_elections_available: generalElectionDates.size,
    primary_elections_voted: primaryVoted,
    last_vote_date: lastVoteDate,
    turnout_score: turnoutScore,
    turnout_propensity: turnoutBand(turnoutScore),
    primary_count: primaryVoted,
    primary_engagement: formatPrimaryEngagement(primaryVoted),
  };
}

export function buildHistorySummaryMap(content: string): Map<string, VoterHistorySummary> {
  const { byVoter, generalElectionDates } = buildHistoryIndex(content);
  const summaries = new Map<string, VoterHistorySummary>();

  for (const [voterId, events] of byVoter) {
    summaries.set(voterId, summarizeVoterHistory(events, generalElectionDates));
  }

  return summaries;
}