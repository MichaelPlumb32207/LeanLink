/**
 * Grok committee classifier (ENH-018 Unit B) — the constructive payoff of the
 * T3/OSINT dig: Grok is unreliable at researching anonymous private voters but
 * excellent at classifying PUBLIC political committees (they're prominent,
 * finite, and knowable). So we point it at committees, not voters — one call per
 * committee (batched), and the result flows to every linked donor via the
 * committee-label mechanism.
 *
 * Critically it must LEAVE bipartisan corporate/trade PACs Undetermined — a
 * company that gives to both parties reveals nothing about a donor's lean, and
 * labeling it would manufacture false signal. No web search (Grok's own
 * knowledge); obscure/unknown committees should come back Undetermined, not
 * guessed.
 */
import { getXaiApiKey, getXaiModel, xaiResponsesWithWebSearch } from '@/lib/xai/client';
import type { LeanLabel } from '@/lib/enrichment/types';

export interface CommitteeClassification {
  committee_name: string;
  lean: LeanLabel;
  confidence: number;
  reason: string;
}

const SYSTEM = `You classify US political committees / PACs by ideological lean for a research tool. For each committee decide "lean":
- "Left"  — Democratic-aligned candidate/party/joint-fundraising committees, and progressive or labor-union PACs.
- "Right" — Republican-aligned candidate/party/joint-fundraising committees, and conservative PACs.
- "Independent" — genuinely third-party or independent candidate committees only.
- "Undetermined" — use for GENUINELY BIPARTISAN corporate or trade-association PACs that give to both parties (e.g. "CSX Good Government Fund", corporate "* PAC FUND", "Realtors PAC"), OR any committee you do not confidently recognize. DO NOT GUESS.
confidence: 0-100, how sure you are of a partisan lean (bipartisan or unknown → Undetermined, not a low-confidence guess).
reason: one short clause, e.g. "Kamala Harris joint fundraising committee" or "bipartisan corporate PAC".
Return ONLY a JSON array, no prose, no code fences: [{"committee_name":"...","lean":"...","confidence":0,"reason":"..."}]. Echo committee_name back EXACTLY as given.`;

function normalizeLean(v: unknown): LeanLabel {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'left') return 'Left';
  if (s === 'right') return 'Right';
  if (s === 'independent') return 'Independent';
  return 'Undetermined';
}

function clampConf(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Tolerant JSON-array parse: strip code fences, slice to the outermost [...]. */
function parseJsonArray(text: string): unknown[] {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface ClassifyResult {
  results: CommitteeClassification[];
  cost_usd: number;
  batches: number;
}

/** Classify committees in batches. Throws if XAI_API_KEY is missing. */
export async function classifyCommittees(
  names: string[],
  opts?: { batchSize?: number },
): Promise<ClassifyResult> {
  if (!getXaiApiKey()) {
    throw new Error('XAI_API_KEY not set — the committee classifier needs live Grok.');
  }
  const batchSize = Math.max(1, opts?.batchSize ?? 40);
  const model = getXaiModel();
  const byName = new Map<string, CommitteeClassification>();
  let cost = 0;
  let batches = 0;

  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    const userPrompt = `Classify these ${batch.length} committees:\n${batch
      .map((n, j) => `${j + 1}. ${n}`)
      .join('\n')}`;
    const res = await xaiResponsesWithWebSearch({
      model,
      systemPrompt: SYSTEM,
      userPrompt,
      enableWebSearch: false,
    });
    batches += 1;
    cost += res.usage?.cost_usd ?? 0;

    for (const raw of parseJsonArray(res.text)) {
      const o = raw as Record<string, unknown>;
      const name = typeof o?.committee_name === 'string' ? o.committee_name.trim() : '';
      if (!name) continue;
      byName.set(name.toLowerCase(), {
        committee_name: name,
        lean: normalizeLean(o.lean),
        confidence: clampConf(o.confidence),
        reason: String(o.reason ?? '').slice(0, 200),
      });
    }
  }

  // Preserve input order; committees Grok dropped default to Undetermined.
  const results = names.map(
    (n) =>
      byName.get(n.toLowerCase()) ?? {
        committee_name: n,
        lean: 'Undetermined' as const,
        confidence: 0,
        reason: 'not returned by classifier',
      },
  );
  return { results, cost_usd: cost, batches };
}
