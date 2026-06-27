const XAI_BASE_URL = 'https://api.x.ai/v1';

export interface XaiResponsesOptions {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  enableWebSearch?: boolean;
}

export interface XaiUsageSummary {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd_ticks: number;
  cost_usd: number;
  web_search_calls: number;
}

export interface XaiResponsesResult {
  text: string;
  citations: string[];
  usage: XaiUsageSummary | null;
  raw: unknown;
}

const TICKS_PER_USD = 10_000_000_000;

function addUniqueUrl(urls: string[], seen: Set<string>, url: unknown) {
  if (typeof url !== 'string' || !url.trim()) return;
  const normalized = url.trim();
  if (seen.has(normalized)) return;
  seen.add(normalized);
  urls.push(normalized);
}

/** URLs from web_search_call sources and url_citation annotations in Responses API output. */
export function extractWebSearchUrls(data: unknown): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  if (!data || typeof data !== 'object') return urls;
  const d = data as Record<string, unknown>;

  if (Array.isArray(d.citations)) {
    for (const item of d.citations) {
      if (typeof item === 'string') addUniqueUrl(urls, seen, item);
      else if (item && typeof item === 'object' && 'url' in item) {
        addUniqueUrl(urls, seen, (item as { url: unknown }).url);
      }
    }
  }

  if (!Array.isArray(d.output)) return urls;

  for (const item of d.output) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;

    if (o.type === 'web_search_call') {
      const action = o.action as Record<string, unknown> | undefined;
      if (action && Array.isArray(action.sources)) {
        for (const src of action.sources) {
          if (src && typeof src === 'object' && 'url' in src) {
            addUniqueUrl(urls, seen, (src as { url: unknown }).url);
          }
        }
      }
    }

    if (o.type === 'message' && Array.isArray(o.content)) {
      for (const part of o.content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as Record<string, unknown>;
        if (!Array.isArray(p.annotations)) continue;
        for (const ann of p.annotations) {
          if (
            ann &&
            typeof ann === 'object' &&
            (ann as { type?: string }).type === 'url_citation'
          ) {
            addUniqueUrl(urls, seen, (ann as { url?: unknown }).url);
          }
        }
      }
    }
  }

  return urls;
}

export function extractUsageSummary(data: unknown): XaiUsageSummary | null {
  if (!data || typeof data !== 'object') return null;
  const usage = (data as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object') return null;

  const u = usage as Record<string, unknown>;
  const ticks = Number(u.cost_in_usd_ticks ?? 0);
  const toolDetails = u.server_side_tool_usage_details as Record<string, unknown> | undefined;

  return {
    input_tokens: Number(u.input_tokens ?? 0),
    output_tokens: Number(u.output_tokens ?? 0),
    total_tokens: Number(u.total_tokens ?? 0),
    cost_usd_ticks: ticks,
    cost_usd: ticks / TICKS_PER_USD,
    web_search_calls: Number(
      toolDetails?.web_search_calls ?? u.num_server_side_tools_used ?? 0,
    ),
  };
}

function textFromContentPart(part: unknown): string {
  if (!part || typeof part !== 'object') return '';
  const p = part as Record<string, unknown>;
  if (p.type === 'output_text' && typeof p.text === 'string') return p.text;
  if (typeof p.text === 'string') return p.text;
  if (typeof p.content === 'string') return p.content;
  return '';
}

function extractResponseText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;

  if (typeof d.output_text === 'string') return d.output_text;

  if (Array.isArray(d.output)) {
    const chunks: string[] = [];
    for (const item of d.output) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if (o.type === 'message' && Array.isArray(o.content)) {
        for (const part of o.content) {
          const t = textFromContentPart(part);
          if (t) chunks.push(t);
        }
      } else if (typeof o.content === 'string') {
        chunks.push(o.content);
      }
    }
    if (chunks.length) return chunks.join('\n');
  }

  if (Array.isArray(d.choices)) {
    const choice = d.choices[0] as Record<string, unknown> | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === 'string') return message.content;
  }

  return '';
}

export function getXaiApiKey(): string | null {
  const key = process.env.XAI_API_KEY?.trim();
  return key || null;
}

export function getXaiModel(): string {
  return process.env.XAI_MODEL?.trim() || 'grok-4.3';
}

export async function xaiResponsesWithWebSearch(
  options: XaiResponsesOptions,
): Promise<XaiResponsesResult> {
  const apiKey = getXaiApiKey();
  if (!apiKey) {
    throw new Error('XAI_API_KEY is not configured');
  }

  const body: Record<string, unknown> = {
    model: options.model,
    input: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ],
  };

  if (options.enableWebSearch !== false) {
    body.tools = [{ type: 'web_search' }];
  }

  const response = await fetch(`${XAI_BASE_URL}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof raw === 'object' && raw && 'error' in raw
        ? JSON.stringify((raw as { error: unknown }).error)
        : JSON.stringify(raw);
    throw new Error(`xAI API ${response.status}: ${detail}`);
  }

  return {
    text: extractResponseText(raw),
    citations: extractWebSearchUrls(raw),
    usage: extractUsageSummary(raw),
    raw,
  };
}