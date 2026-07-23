/**
 * Pure scorer for Exa People results → identity candidates.
 *
 * Hard rules (Phase 0):
 * - Partial names ("Ezra Thomas" for "Ezra Thomas Childs") must not pass as strong matches.
 * - Location corroboration (city / county / state) required for high scores.
 * - Job title / company NEVER imply lean — only identity support.
 */
import { exaPeopleMaxCandidates } from '@/lib/exa/config';
import type {
  ExaPeopleAnchor,
  ExaPeopleCandidate,
  ExaSearchResult,
} from '@/lib/exa/types';

function normToken(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normToken(s).split(/\s+/).filter(Boolean);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Display name from entity, title, or URL slug. */
export function candidateDisplayName(result: ExaSearchResult): string {
  if (result.person?.name) return result.person.name;
  if (result.person?.firstName || result.person?.lastName) {
    return [result.person.firstName, result.person.lastName].filter(Boolean).join(' ');
  }
  // Title often "Jane Doe - Role @ Co"
  const title = result.title.split(/[-|–—]/)[0]?.trim();
  if (title && title.length > 1 && title.length < 80) return title;
  return result.author?.trim() || result.url;
}

function candidateLocation(result: ExaSearchResult): string | null {
  if (result.person?.location) return result.person.location;
  const fromWork = result.person?.workHistory.find((w) => w.location)?.location;
  return fromWork ?? null;
}

/**
 * Name fidelity gate.
 * - Requires last name match (or strong full-token coverage).
 * - Requires first name match (or initial) when anchor has a first name.
 * - Penalizes missing middle when anchor has a distinctive middle (3+ letters)
 *   and candidate has a *different* middle token.
 */
export function scoreNameMatch(
  anchor: ExaPeopleAnchor,
  candidateName: string,
): { score: number; reasons: string[]; reject: boolean } {
  const reasons: string[] = [];
  const aFirst = normToken(anchor.firstName);
  const aMiddle = normToken(anchor.middleName ?? '');
  const aLast = normToken(anchor.lastName);
  const cTokens = tokens(candidateName);
  const cSet = new Set(cTokens);

  if (!aLast || cTokens.length === 0) {
    return { score: 0, reasons: ['missing_name'], reject: true };
  }

  if (!cSet.has(aLast)) {
    // Allow hyphenated last or compound last containing last token
    const lastHit = cTokens.some((t) => t === aLast || t.includes(aLast) || aLast.includes(t));
    if (!lastHit) {
      return { score: 0, reasons: ['last_name_mismatch'], reject: true };
    }
    reasons.push('last_name_fuzzy');
  } else {
    reasons.push('last_name_match');
  }

  if (aFirst) {
    const firstOk =
      cSet.has(aFirst) ||
      cTokens.some((t) => t === aFirst[0] || (t.length === 1 && aFirst.startsWith(t)));
    if (!firstOk) {
      // Common trap: "Alex Meier" for "Alexandra Elizabeth Meier"
      const prefix =
        cTokens.some((t) => aFirst.startsWith(t) && t.length >= 4) ||
        cTokens.some((t) => t.startsWith(aFirst) && aFirst.length >= 4);
      if (!prefix) {
        return { score: 0, reasons: [...reasons, 'first_name_mismatch'], reject: true };
      }
      reasons.push('first_name_prefix');
    } else if (cSet.has(aFirst)) {
      reasons.push('first_name_match');
    } else {
      reasons.push('first_initial_match');
    }
  }

  // Middle-name trap: "Ezra Thomas" vs "Ezra Thomas Childs" —
  // if anchor last is Childs and candidate last is Thomas, already rejected.
  // If anchor is Ezra Thomas Childs and candidate is Ezra Thomas:
  // last_name_mismatch on Childs → reject. Good.
  // If anchor has middle "Thomas" and candidate omits it: soft penalty only.
  if (aMiddle && aMiddle.length >= 3) {
    if (cSet.has(aMiddle)) {
      reasons.push('middle_name_match');
    } else {
      // Extra tokens on candidate that look like alternate middles
      const extras = cTokens.filter((t) => t !== aFirst && t !== aLast && t.length > 1);
      if (extras.length > 0 && !extras.includes(aMiddle)) {
        reasons.push('middle_name_absent_or_diff');
      }
    }
  }

  // Token coverage of full anchor name
  const aAll = tokens(
    anchor.fullName || [anchor.firstName, anchor.middleName, anchor.lastName].filter(Boolean).join(' '),
  );
  const covered = aAll.filter((t) => cSet.has(t) || cTokens.some((c) => c.startsWith(t) || t.startsWith(c)));
  const coverage = aAll.length ? covered.length / aAll.length : 0;

  // Require covering first+last at minimum (already gated); score from coverage
  let score = 0.55 + 0.45 * coverage;
  if (reasons.includes('first_name_prefix')) score -= 0.12;
  if (reasons.includes('first_initial_match')) score -= 0.08;
  if (reasons.includes('middle_name_match')) score += 0.05;
  if (reasons.includes('last_name_fuzzy')) score -= 0.1;

  // Partial-name rejection: candidate has fewer tokens than first+last and
  // misses a required last component already handled. If candidate is only
  // first+something and we expected 3+ tokens, soft-cap.
  if (aAll.length >= 3 && cTokens.length <= 2 && coverage < 0.67) {
    return {
      score: clamp01(score * 0.4),
      reasons: [...reasons, 'partial_name_too_thin'],
      reject: true,
    };
  }

  return { score: clamp01(score), reasons, reject: score < 0.45 };
}

export function scoreLocationMatch(
  anchor: ExaPeopleAnchor,
  location: string | null,
  workLocations: string[],
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const city = normToken(anchor.city);
  const county = normToken(anchor.countyLabel ?? '');
  const state = normToken(anchor.state ?? 'florida') || 'florida';

  const blobs = [location, ...workLocations].filter(Boolean).map((s) => normToken(String(s)));
  if (blobs.length === 0) {
    return { score: 0.15, reasons: ['location_missing'] };
  }

  const hay = blobs.join(' | ');
  let score = 0.2;

  if (city && hay.includes(city)) {
    score += 0.45;
    reasons.push('city_match');
  }
  if (county) {
    const countyCore = county.replace(/\s+county$/, '');
    if (hay.includes(county) || (countyCore && hay.includes(countyCore))) {
      score += 0.25;
      reasons.push('county_match');
    }
  }
  if (state && (hay.includes(state) || hay.includes(' fl ') || hay.endsWith(' fl') || hay.includes('florida'))) {
    score += 0.2;
    reasons.push('state_match');
  } else if (state && !hay.includes(state) && !hay.includes('florida')) {
    score -= 0.25;
    reasons.push('state_mismatch');
  }

  if (!reasons.includes('city_match') && !reasons.includes('county_match')) {
    // FL-only is weak identity (state is large)
    if (reasons.includes('state_match')) {
      score = Math.min(score, 0.4);
      reasons.push('geo_state_only');
    } else {
      score = Math.min(score, 0.25);
    }
  }

  return { score: clamp01(score), reasons };
}

export function scorePeopleResult(
  anchor: ExaPeopleAnchor,
  result: ExaSearchResult,
): ExaPeopleCandidate | null {
  const name = candidateDisplayName(result);
  const location = candidateLocation(result);
  const nameHit = scoreNameMatch(anchor, name);
  if (nameHit.reject) return null;

  const workLocations = (result.person?.workHistory ?? [])
    .map((w) => w.location)
    .filter((x): x is string => Boolean(x));
  const geo = scoreLocationMatch(anchor, location, workLocations);

  // Combine: name dominates; geo required for high band
  let matchScore = 0.65 * nameHit.score + 0.35 * geo.score;
  if (geo.reasons.includes('city_match') || geo.reasons.includes('county_match')) {
    matchScore += 0.05;
  } else {
    // Cap without city/county — Phase 0 collision hazard
    matchScore = Math.min(matchScore, 0.54);
  }

  // Employer hint boost (identity only)
  const employer = normToken(anchor.employerHint ?? '');
  const companies = (result.person?.workHistory ?? [])
    .map((w) => w.companyName)
    .filter((x): x is string => Boolean(x));
  if (employer && companies.some((c) => normToken(c).includes(employer) || employer.includes(normToken(c)))) {
    matchScore = Math.min(1, matchScore + 0.1);
    nameHit.reasons.push('employer_hint_match');
  }

  matchScore = clamp01(matchScore);
  // Floor for returned candidates
  if (matchScore < 0.45) return null;

  const workTitles = (result.person?.workHistory ?? [])
    .map((w) => w.title)
    .filter((x): x is string => Boolean(x));

  return {
    url: result.url,
    title: result.title,
    name,
    location,
    matchScore,
    matchReasons: [...nameHit.reasons, ...geo.reasons],
    workTitles,
    companyNames: companies,
    highlights: result.highlights.slice(0, 4),
    source: result,
  };
}

export function scorePeopleResults(
  anchor: ExaPeopleAnchor,
  results: ExaSearchResult[],
  maxCandidates = exaPeopleMaxCandidates(),
): ExaPeopleCandidate[] {
  const scored: ExaPeopleCandidate[] = [];
  for (const r of results) {
    const c = scorePeopleResult(anchor, r);
    if (c) scored.push(c);
  }
  scored.sort((a, b) => b.matchScore - a.matchScore);
  // Dedupe by URL
  const seen = new Set<string>();
  const out: ExaPeopleCandidate[] = [];
  for (const c of scored) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
    if (out.length >= maxCandidates) break;
  }
  return out;
}
