const XAI_BASE_URL = 'https://api.x.ai/v1';

export interface XaiResponsesOptions {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  enableWebSearch?: boolean;
}

export interface XaiResponsesResult {
  text: string;
  citations: string[];
  raw: unknown;
}

function collectCitations(data: Record<string, unknown>): string[] {
  const citations: string[] = [];
  const raw = data.citations;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') citations.push(item);
      else if (item && typeof item === 'object' && 'url' in item) {
        citations.push(String((item as { url: unknown }).url));
      }
    }
  }
  return citations;
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
    citations: collectCitations(raw as Record<string, unknown>),
    raw,
  };
}