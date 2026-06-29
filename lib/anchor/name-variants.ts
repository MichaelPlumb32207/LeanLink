import type { EmailInsights } from '@/lib/enrichment/email-insights';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export type NameVariantSource =
  | 'canonical'
  | 'spelling_variant'
  | 'email_maiden'
  | 'middle_expanded';

export interface NameSearchVariant {
  full_name: string;
  source: NameVariantSource;
  note: string;
}

/** Common first-name spelling pairs (file-grounded expansion for FEC/OSINT queries). */
const FIRST_NAME_PAIRS: [string, string][] = [
  ['maria', 'marcia'],
  ['marcia', 'maria'],
  ['catherine', 'kathryn'],
  ['kathryn', 'catherine'],
  ['katherine', 'catherine'],
  ['teresa', 'theresa'],
  ['theresa', 'teresa'],
  ['ann', 'anne'],
  ['anne', 'ann'],
  ['jon', 'john'],
  ['john', 'jon'],
  ['mike', 'michael'],
  ['michael', 'mike'],
  ['bob', 'robert'],
  ['robert', 'bob'],
  ['bill', 'william'],
  ['william', 'bill'],
  ['jim', 'james'],
  ['james', 'jim'],
  ['joe', 'joseph'],
  ['joseph', 'joe'],
];

function buildFullName(first: string, middle: string, last: string, suffix: string): string {
  const parts = [first, middle, last, suffix].map((p) => p?.trim()).filter(Boolean);
  return parts.join(' ');
}

function swapFirstName(
  record: ParsedFlVoterRecord,
  newFirst: string,
  source: NameVariantSource,
  note: string,
): NameSearchVariant {
  return {
    full_name: buildFullName(
      newFirst,
      record.name.middle,
      record.name.last,
      record.name.suffix,
    ),
    source,
    note,
  };
}

/**
 * Expand FEC/OSINT search names from voter-file anchor + email hints.
 * Does not assert identity — only widens retrieval queries.
 */
export function buildNameSearchVariants(
  record: ParsedFlVoterRecord,
  emailInsights: EmailInsights,
): NameSearchVariant[] {
  const seen = new Set<string>();
  const variants: NameSearchVariant[] = [];

  const push = (v: NameSearchVariant) => {
    const key = v.full_name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    variants.push(v);
  };

  push({
    full_name: record.name.full.trim(),
    source: 'canonical',
    note: 'Voter file legal name',
  });

  const first = record.name.first.trim();
  const firstLower = first.toLowerCase();
  for (const [a, b] of FIRST_NAME_PAIRS) {
    if (firstLower === a) {
      push(swapFirstName(record, b.charAt(0).toUpperCase() + b.slice(1), 'spelling_variant', `${a} ↔ ${b} first-name variant`));
    }
  }

  if (record.name.middle.trim()) {
    const mi = record.name.middle.trim();
    const expandedFirst =
      mi.length === 1 ? `${first} ${mi}.` : `${first} ${mi}`;
    push({
      full_name: buildFullName(expandedFirst, '', record.name.last, record.name.suffix),
      source: 'middle_expanded',
      note: 'First + middle for directory-style listings',
    });
  }

  const maiden = emailInsights.possible_maiden_or_alias?.trim();
  if (maiden) {
    const maidenCap =
      maiden.charAt(0).toUpperCase() + maiden.slice(1).toLowerCase();
    push({
      full_name: buildFullName(first, maidenCap, record.name.last, record.name.suffix),
      source: 'email_maiden',
      note: `Email local-part suggests maiden/alias "${maiden}"`,
    });
    push({
      full_name: buildFullName(maidenCap, '', record.name.last, record.name.suffix),
      source: 'email_maiden',
      note: `Maiden/alias as given name with file surname`,
    });
  }

  return variants;
}

/** Names to try in FEC strict queries (canonical first, then alternates). */
export function fecQueryNames(variants: NameSearchVariant[], maxNames = 3): string[] {
  return variants.slice(0, maxNames).map((v) => v.full_name);
}