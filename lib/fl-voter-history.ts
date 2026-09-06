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

/**
 * Coarse pattern over general elections only (not ideology).
 * - presidential_years_only: all GEN votes in presidential years (year % 4 === 0)
 * - midterm_years_only: all GEN votes in midterm years (year % 4 === 2)
 * - multi_cycle: GEN votes in both presidential and midterm years
 * - none: no GEN votes recorded
 * - unknown: summary predates these fields and cannot be re-derived
 */
export type VotePattern =
  | 'none'
  | 'presidential_years_only'
  | 'midterm_years_only'
  | 'multi_cycle'
  | 'unknown';

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
  /** GEN ballots cast in presidential years (YYYY % 4 === 0). Optional on pre-2026-07-31 rows. */
  presidential_generals_voted?: number;
  /** GEN ballots cast in midterm years (YYYY % 4 === 2). */
  midterm_generals_voted?: number;
  /** Other GEN years (odd-year specials etc.). */
  other_generals_voted?: number;
  vote_pattern?: VotePattern;
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

/** FL history dates are MM/DD/YYYY. */
export function parseHistoryElectionDate(date: string): { y: number; m: number; d: number } | null {
  const m = date.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return { m: Number(m[1]), d: Number(m[2]), y: Number(m[3]) };
}

function compareHistoryDates(a: string, b: string): number {
  const pa = parseHistoryElectionDate(a);
  const pb = parseHistoryElectionDate(b);
  if (pa && pb) {
    if (pa.y !== pb.y) return pa.y - pb.y;
    if (pa.m !== pb.m) return pa.m - pb.m;
    return pa.d - pb.d;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function votePatternFromCounts(pres: number, mid: number, other: number): VotePattern {
  const total = pres + mid + other;
  if (total <= 0) return 'none';
  if (pres > 0 && mid === 0 && other === 0) return 'presidential_years_only';
  if (mid > 0 && pres === 0 && other === 0) return 'midterm_years_only';
  return 'multi_cycle';
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
      presidential_generals_voted: 0,
      midterm_generals_voted: 0,
      other_generals_voted: 0,
      vote_pattern: 'none',
    };
  }

  const genVotedDates = new Set<string>();
  let primaryVoted = 0;
  let lastVoteDate: string | null = null;
  let presidentialGen = 0;
  let midtermGen = 0;
  let otherGen = 0;

  for (const event of events) {
    if (!voted(event.historyCode)) continue;

    if (
      event.electionDate &&
      (!lastVoteDate || compareHistoryDates(event.electionDate, lastVoteDate) > 0)
    ) {
      lastVoteDate = event.electionDate;
    }

    if (event.electionType === 'GEN') {
      genVotedDates.add(event.electionDate);
      const parsed = parseHistoryElectionDate(event.electionDate);
      if (parsed) {
        const mod = parsed.y % 4;
        if (mod === 0) presidentialGen += 1;
        else if (mod === 2) midtermGen += 1;
        else otherGen += 1;
      } else {
        otherGen += 1;
      }
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
    presidential_generals_voted: presidentialGen,
    midterm_generals_voted: midtermGen,
    other_generals_voted: otherGen,
    vote_pattern: votePatternFromCounts(presidentialGen, midtermGen, otherGen),
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