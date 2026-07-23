/**
 * Exa config — retrieval vendor only (people + web + contents).
 * Judgment / lean guardrails stay on xAI (see docs/CLAUDE.md AI vendor table).
 */

export function getExaApiKey(): string | null {
  const key = process.env.EXA_API_KEY?.trim();
  return key || null;
}

export function exaDefaultNumResults(): number {
  const n = Number(process.env.EXA_NUM_RESULTS ?? 5);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 20) : 5;
}

/** Max people candidates returned after scoring (post-filter). */
export function exaPeopleMaxCandidates(): number {
  const n = Number(process.env.EXA_PEOPLE_MAX_CANDIDATES ?? 3);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 10) : 3;
}
