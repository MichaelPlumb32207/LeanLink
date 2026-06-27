/** Normalize FL voter file phone e.g. "850-6438005" → "850-643-8005". */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw.trim();
}

export function phoneSearchVariants(raw: string | null | undefined): string[] {
  const normalized = normalizePhone(raw);
  if (!normalized) return [];
  const digits = normalized.replace(/\D/g, '');
  const variants = [
    normalized,
    digits,
    `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
    `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`,
  ];
  return [...new Set(variants)];
}