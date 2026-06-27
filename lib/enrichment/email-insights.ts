export interface EmailInsights {
  local_part: string | null;
  domain: string | null;
  username_variants: string[];
  name_tokens_from_email: string[];
  possible_maiden_or_alias: string | null;
  insight_note: string | null;
}

const EMPTY: EmailInsights = {
  local_part: null,
  domain: null,
  username_variants: [],
  name_tokens_from_email: [],
  possible_maiden_or_alias: null,
  insight_note: null,
};

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function parseEmailInsights(
  email: string | null | undefined,
  nameFull: string,
): EmailInsights {
  if (!email?.trim() || !email.includes('@')) return { ...EMPTY };

  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  const localRaw = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  const local = localRaw.toLowerCase();

  const username_variants = new Set<string>();
  username_variants.add(local);
  username_variants.add(local.replace(/[._-]/g, ''));
  username_variants.add(localRaw);

  const name_tokens_from_email = local
    .split(/[._-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  for (const token of name_tokens_from_email) {
    username_variants.add(token);
  }

  const nameParts = nameFull
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeToken);
  const surname = nameParts[nameParts.length - 1] ?? '';

  let possible_maiden_or_alias: string | null = null;
  let insight_note: string | null = null;

  if (name_tokens_from_email.length >= 2) {
    const lastToken = normalizeToken(name_tokens_from_email[name_tokens_from_email.length - 1]);
    const firstToken = normalizeToken(name_tokens_from_email[0]);

    if (
      lastToken.length >= 2 &&
      lastToken !== surname &&
      !surname.includes(lastToken) &&
      !lastToken.includes(surname)
    ) {
      possible_maiden_or_alias = name_tokens_from_email[name_tokens_from_email.length - 1];
      insight_note = `Email local-part "${local}" — trailing token "${possible_maiden_or_alias}" differs from surname; treat as possible maiden name or alias for social username search.`;
      username_variants.add(`${firstToken}${lastToken}`);
      username_variants.add(`${firstToken}.${lastToken}`);
      username_variants.add(`${firstToken}_${lastToken}`);
    }
  } else if (name_tokens_from_email.length === 1) {
    const token = normalizeToken(name_tokens_from_email[0]);
    if (token.length >= 3 && token !== surname && !surname.includes(token)) {
      insight_note = `Email username "${local}" may be a handle or alias — search as-is on X, Instagram, Facebook, LinkedIn.`;
    }
  }

  return {
    local_part: local,
    domain,
    username_variants: [...username_variants].filter(Boolean).slice(0, 12),
    name_tokens_from_email,
    possible_maiden_or_alias,
    insight_note,
  };
}