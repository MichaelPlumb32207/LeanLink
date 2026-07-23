/**
 * Offline canary for Exa people scorer (no API, no DB, synthetic fixtures only).
 *
 *   npx tsx scripts/smoke-exa-people-scorer.ts
 */
import {
  scoreNameMatch,
  scorePeopleResult,
  scorePeopleResults,
} from '@/lib/exa/score-people';
import type { ExaPeopleAnchor, ExaSearchResult } from '@/lib/exa/types';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function personResult(
  partial: Partial<ExaSearchResult> & {
    name: string;
    location?: string | null;
    url?: string;
  },
): ExaSearchResult {
  const [firstName, ...rest] = partial.name.split(/\s+/);
  const lastName = rest[rest.length - 1] ?? '';
  return {
    id: partial.id ?? null,
    title: partial.title ?? partial.name,
    url: partial.url ?? `https://linkedin.com/in/${partial.name.replace(/\s+/g, '-').toLowerCase()}`,
    author: null,
    publishedDate: null,
    text: null,
    highlights: partial.highlights ?? [],
    summary: null,
    person: {
      name: partial.name,
      firstName,
      lastName,
      location: partial.location ?? null,
      workHistory: [],
      educationSummary: [],
      ...(partial.person ?? {}),
    },
  };
}

const anchorChilds: ExaPeopleAnchor = {
  firstName: 'Ezra',
  middleName: 'Thomas',
  lastName: 'Childs',
  fullName: 'Ezra Thomas Childs',
  city: 'Altha',
  countyLabel: 'Calhoun County',
  state: 'Florida',
};

const anchorSeraphin: ExaPeopleAnchor = {
  firstName: 'Marie',
  middleName: 'Nancy',
  lastName: 'Seraphin',
  fullName: 'Marie Nancy Seraphin',
  city: 'Gainesville',
  countyLabel: 'Alachua County',
  state: 'Florida',
};

function main() {
  // Partial name must reject (Phase 0 trap)
  const partial = scoreNameMatch(anchorChilds, 'Ezra Thomas');
  assert(partial.reject, 'expected reject on partial Ezra Thomas');

  // Wrong last name reject
  const wrong = scoreNameMatch(anchorChilds, 'Ezra Thomas Smith');
  assert(wrong.reject, 'expected reject on wrong last name');

  // Full name accept
  const full = scoreNameMatch(anchorChilds, 'Ezra Thomas Childs');
  assert(!full.reject && full.score >= 0.7, `expected strong full name, got ${full.score}`);

  // Collision: right-ish name, wrong city → capped / null
  const collision = scorePeopleResult(
    anchorChilds,
    personResult({
      name: 'Ezra Thomas Childs',
      location: 'Jacksonville, Florida, United States',
    }),
  );
  // Jacksonville ≠ Altha — may still return with state-only cap ≤ 0.54
  if (collision) {
    assert(
      collision.matchScore <= 0.54,
      `expected geo cap without city match, got ${collision.matchScore}`,
    );
  }

  // Strong public-footprint hit
  const hit = scorePeopleResult(
    anchorSeraphin,
    personResult({
      name: 'Marie Nancy Séraphin',
      location: 'Gainesville, Florida, United States',
      url: 'https://linkedin.com/in/nseraphin',
    }),
  );
  assert(hit, 'expected Seraphin hit');
  assert(hit!.matchScore >= 0.7, `expected strong Seraphin score, got ${hit!.matchScore}`);
  assert(hit!.matchReasons.includes('city_match'), 'expected city_match');

  // Fuzzy Janelle Stewart vs Janelle Rayjean Steward — last name mismatch → reject
  const steward: ExaPeopleAnchor = {
    firstName: 'Janelle',
    middleName: 'Rayjean',
    lastName: 'Steward',
    fullName: 'Janelle Rayjean Steward',
    city: 'Gainesville',
    state: 'Florida',
  };
  const fuzzy = scorePeopleResult(
    steward,
    personResult({
      name: 'Janelle Stewart',
      location: 'Tampa, Florida, United States',
    }),
  );
  assert(fuzzy === null, 'expected null for Steward vs Stewart');

  // Ranking + max candidates
  const ranked = scorePeopleResults(
    anchorSeraphin,
    [
      personResult({
        name: 'Anne Seraphine',
        location: 'Gainesville, Florida, United States',
        url: 'https://example.com/a',
      }),
      personResult({
        name: 'Marie Nancy Seraphin',
        location: 'Gainesville, Florida, United States',
        url: 'https://example.com/b',
      }),
    ],
    3,
  );
  assert(ranked.length >= 1, 'expected at least one ranked candidate');
  assert(
    ranked[0].name.toLowerCase().includes('marie'),
    `expected Marie first, got ${ranked[0].name}`,
  );

  console.log('smoke-exa-people-scorer: OK');
}

main();
