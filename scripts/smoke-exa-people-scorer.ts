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

/** Synthetic GOLDEN family — middle-name trap (first+middle without last). */
const anchorGolden: ExaPeopleAnchor = {
  firstName: 'Alex',
  middleName: 'Thomas',
  lastName: 'Golden',
  fullName: 'Alex Thomas Golden',
  city: 'Altha',
  countyLabel: 'Calhoun County',
  state: 'Florida',
};

/** Synthetic public-footprint identity (accent + city corroboration). */
const anchorHarbor: ExaPeopleAnchor = {
  firstName: 'Maya',
  middleName: 'Nancy',
  lastName: 'Harbor',
  fullName: 'Maya Nancy Harbor',
  city: 'Gainesville',
  countyLabel: 'Alachua County',
  state: 'Florida',
};

function main() {
  // Partial name must reject (Phase 0 trap)
  const partial = scoreNameMatch(anchorGolden, 'Alex Thomas');
  assert(partial.reject, 'expected reject on partial Alex Thomas');

  // Wrong last name reject
  const wrong = scoreNameMatch(anchorGolden, 'Alex Thomas Smith');
  assert(wrong.reject, 'expected reject on wrong last name');

  // Full name accept
  const full = scoreNameMatch(anchorGolden, 'Alex Thomas Golden');
  assert(!full.reject && full.score >= 0.7, `expected strong full name, got ${full.score}`);

  // Collision: right-ish name, wrong city → capped / null
  const collision = scorePeopleResult(
    anchorGolden,
    personResult({
      name: 'Alex Thomas Golden',
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

  // Strong public-footprint hit (accented last name still matches)
  const hit = scorePeopleResult(
    anchorHarbor,
    personResult({
      name: 'Maya Nancy Harbór',
      location: 'Gainesville, Florida, United States',
      url: 'https://example.com/in/maya-harbor',
    }),
  );
  assert(hit, 'expected Harbor hit');
  assert(hit!.matchScore >= 0.7, `expected strong Harbor score, got ${hit!.matchScore}`);
  assert(hit!.matchReasons.includes('city_match'), 'expected city_match');

  // Fuzzy last-name mismatch → reject (Linden vs Lindon)
  const linden: ExaPeopleAnchor = {
    firstName: 'Janelle',
    middleName: 'Rayjean',
    lastName: 'Linden',
    fullName: 'Janelle Rayjean Linden',
    city: 'Gainesville',
    state: 'Florida',
  };
  const fuzzy = scorePeopleResult(
    linden,
    personResult({
      name: 'Janelle Lindon',
      location: 'Tampa, Florida, United States',
    }),
  );
  assert(fuzzy === null, 'expected null for Linden vs Lindon');

  // Ranking + max candidates
  const ranked = scorePeopleResults(
    anchorHarbor,
    [
      personResult({
        name: 'Anne Harborage',
        location: 'Gainesville, Florida, United States',
        url: 'https://example.com/a',
      }),
      personResult({
        name: 'Maya Nancy Harbor',
        location: 'Gainesville, Florida, United States',
        url: 'https://example.com/b',
      }),
    ],
    3,
  );
  assert(ranked.length >= 1, 'expected at least one ranked candidate');
  assert(
    ranked[0].name.toLowerCase().includes('maya'),
    `expected Maya first, got ${ranked[0].name}`,
  );

  console.log('smoke-exa-people-scorer: OK');
}

main();
