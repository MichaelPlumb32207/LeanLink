/** Parse comma/space-separated 0-based row indices for POC test subsets. */
export function parseRowIndicesInput(input: string): number[] {
  const seen = new Set<number>();
  const out: number[] = [];

  for (const part of input.split(/[,\s]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }

  return out;
}

export function formatRowIndices(indices: number[]): string {
  return indices.join(', ');
}