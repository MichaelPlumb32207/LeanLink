import type { EnrichmentBundle, LeanLabel } from '@/lib/enrichment/types';
import {
  fetchStreetViewImage,
  streetViewImageDataUrl,
  type StreetViewFetchResult,
} from '@/lib/google/street-view';
import { getXaiModel, xaiResponsesWithVision, type XaiUsageSummary } from '@/lib/xai/client';

const LEAN_LABELS: LeanLabel[] = ['Left', 'Right', 'Independent', 'Undetermined'];

export type StreetViewVisionStatus =
  | 'ok'
  | 'no_imagery'
  | 'no_address'
  | 'api_unconfigured'
  | 'google_unconfigured'
  | 'error';

export interface StreetViewVisionPayload {
  scene_summary: string;
  visible_signals: string[];
  lean_street_view: LeanLabel;
  lean_street_view_confidence: number;
  evidence: string[];
  imagery_quality: 'clear' | 'partial' | 'obstructed' | 'none';
}

export interface StreetViewVisionResult {
  status: StreetViewVisionStatus;
  address_used: string | null;
  /** data:image/jpeg;base64,... for dashboard preview — not persisted */
  street_view_preview: string | null;
  lean_street_view: LeanLabel;
  lean_street_view_confidence: number;
  visible_signals: string[];
  scene_summary: string;
  evidence: string[];
  imagery_quality: StreetViewVisionPayload['imagery_quality'];
  methodology_note: string;
  usage: XaiUsageSummary | null;
  error_message?: string;
}

const SYSTEM_PROMPT = `You are LeanLink Street View research assistant (experimental, separate from main OSINT lean).

Analyze ONLY the provided Google Street View image of a voter residence area.

STRICT RULES:
- Report ONLY visibly legible political content: yard signs, flags with partisan meaning, campaign banners, bumper stickers on vehicles IN FRAME, window signs.
- If no explicit political signage is visible: lean_street_view MUST be "Undetermined", lean_street_view_confidence <= 25, visible_signals = [].
- NEVER infer lean from: home size, landscaping, neighborhood affluence, vehicle brand, religious symbols (unless explicit campaign signage), race/ethnicity, or demographic stereotypes.
- Do not guess what is inside the home. Street View only.
- Return ONLY valid JSON — no markdown fences.`;

const JSON_SCHEMA = `{
  "scene_summary": "brief neutral description of what is visible",
  "visible_signals": ["only explicit political signage/text visible in the image"],
  "lean_street_view": "Left" | "Right" | "Independent" | "Undetermined",
  "lean_street_view_confidence": 0 to 100,
  "evidence": ["human-readable strings tied to visible signage only"],
  "imagery_quality": "clear" | "partial" | "obstructed" | "none"
}`;

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Model response did not contain JSON object');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

function parseVisionPayload(text: string): StreetViewVisionPayload {
  const parsed = parseJsonObject(text) as Partial<StreetViewVisionPayload> & {
    lean?: LeanLabel;
    confidence?: number;
  };

  const lean = LEAN_LABELS.includes(parsed.lean_street_view as LeanLabel)
    ? (parsed.lean_street_view as LeanLabel)
    : LEAN_LABELS.includes(parsed.lean as LeanLabel)
      ? (parsed.lean as LeanLabel)
      : 'Undetermined';

  const visible_signals = Array.isArray(parsed.visible_signals)
    ? parsed.visible_signals.map(String).filter((s) => s.trim().length > 0)
    : [];

  const quality = ['clear', 'partial', 'obstructed', 'none'].includes(
    String(parsed.imagery_quality),
  )
    ? (parsed.imagery_quality as StreetViewVisionPayload['imagery_quality'])
    : 'partial';

  return {
    scene_summary: String(parsed.scene_summary ?? ''),
    visible_signals,
    lean_street_view: lean,
    lean_street_view_confidence: clamp(
      Math.round(Number(parsed.lean_street_view_confidence ?? parsed.confidence ?? 0)),
      0,
      100,
    ),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
    imagery_quality: quality,
  };
}

export function applyStreetViewGuardrails(
  payload: StreetViewVisionPayload,
): StreetViewVisionPayload {
  const hasSignals = payload.visible_signals.length > 0;

  if (!hasSignals) {
    return {
      ...payload,
      lean_street_view: 'Undetermined',
      lean_street_view_confidence: Math.min(payload.lean_street_view_confidence, 25),
    };
  }

  if (payload.lean_street_view === 'Undetermined') {
    return {
      ...payload,
      lean_street_view_confidence: Math.min(payload.lean_street_view_confidence, 30),
    };
  }

  return {
    ...payload,
    lean_street_view_confidence: Math.min(payload.lean_street_view_confidence, 55),
  };
}

function emptyResult(
  status: StreetViewVisionStatus,
  address: string | null,
  error_message?: string,
): StreetViewVisionResult {
  return {
    status,
    address_used: address,
    street_view_preview: null,
    lean_street_view: 'Undetermined',
    lean_street_view_confidence: 0,
    visible_signals: [],
    scene_summary: '',
    evidence: [],
    imagery_quality: 'none',
    methodology_note:
      'Experimental Street View vision lean — NOT merged into main OSINT lean. Visible signage only.',
    usage: null,
    error_message,
  };
}

function mapFetchStatus(fetch: StreetViewFetchResult): StreetViewVisionStatus {
  if (fetch.status === 'api_unconfigured') return 'google_unconfigured';
  return fetch.status;
}

export async function runStreetViewVisionTest(
  bundle: EnrichmentBundle,
): Promise<StreetViewVisionResult> {
  const residence = bundle.residence_on_file;
  const fetch = await fetchStreetViewImage(residence);

  if (fetch.status !== 'ok' || !fetch.image_bytes) {
    return emptyResult(
      mapFetchStatus(fetch),
      fetch.address_used,
      fetch.error_message,
    );
  }

  const imageDataUrl = streetViewImageDataUrl(fetch.image_bytes);
  const userPrompt = `Voter residence address (for context only — judge ONLY the image):
${fetch.address_used}

County: ${bundle.anchor.county_code} · City: ${bundle.anchor.city} · Precinct: ${bundle.anchor.precinct}
ballot_favors (context only, do not infer without signage): ${bundle.ballot_favors}

Return JSON:
${JSON_SCHEMA}`;

  const response = await xaiResponsesWithVision({
    model: getXaiModel(),
    systemPrompt: SYSTEM_PROMPT,
    userText: userPrompt,
    imageUrl: imageDataUrl,
    detail: 'high',
  });

  const parsed = applyStreetViewGuardrails(parseVisionPayload(response.text));

  return {
    status: 'ok',
    address_used: fetch.address_used,
    street_view_preview: imageDataUrl,
    lean_street_view: parsed.lean_street_view,
    lean_street_view_confidence: parsed.lean_street_view_confidence,
    visible_signals: parsed.visible_signals,
    scene_summary: parsed.scene_summary,
    evidence: parsed.evidence,
    imagery_quality: parsed.imagery_quality,
    methodology_note:
      'Experimental Street View vision lean — NOT merged into main OSINT lean. Visible signage only; guardrails cap confidence and require visible_signals.',
    usage: response.usage,
  };
}