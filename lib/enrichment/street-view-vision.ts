import type { EnrichmentBundle, LeanLabel } from '@/lib/enrichment/types';
import {
  fetchStreetViewImage,
  streetViewImageDataUrl,
  type StreetViewFetchResult,
} from '@/lib/google/street-view';
import { getXaiModel, xaiResponsesWithVision, type XaiUsageSummary } from '@/lib/xai/client';

const LEAN_LABELS: LeanLabel[] = ['Left', 'Right', 'Independent', 'Undetermined'];

export type StreetViewVisionMode = 'strict' | 'exploratory';

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

export interface StreetViewExploratoryPayload extends StreetViewVisionPayload {
  visible_cues: string[];
  inference_reasoning: string[];
  stereotype_factors_used: string[];
}

export interface StreetViewVisionResult {
  vision_mode: StreetViewVisionMode;
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
  /** Exploratory mode only */
  visible_cues?: string[];
  inference_reasoning?: string[];
  stereotype_factors_used?: string[];
  methodology_note: string;
  usage: XaiUsageSummary | null;
  error_message?: string;
}

const STRICT_SYSTEM_PROMPT = `You are LeanLink Street View research assistant (STRICT mode — experimental, separate from main OSINT lean).

Analyze ONLY the provided Google Street View image of a voter residence area.

STRICT RULES:
- Report ONLY visibly legible political content: yard signs, flags with partisan meaning, campaign banners, bumper stickers on vehicles IN FRAME, window signs.
- If no explicit political signage is visible: lean_street_view MUST be "Undetermined", lean_street_view_confidence <= 25, visible_signals = [].
- NEVER infer lean from: home size, landscaping, neighborhood affluence, vehicle brand, religious symbols (unless explicit campaign signage), race/ethnicity, or demographic stereotypes.
- Do not guess what is inside the home. Street View only.
- Return ONLY valid JSON — no markdown fences.`;

const EXPLORATORY_SYSTEM_PROMPT = `You are LeanLink Street View EXPLORATORY inference assistant (research contrast arm — NOT used for production lean).

Your job is to infer a plausible political lean from EVERYTHING visible in the Street View image, using real-world heuristics researchers might later validate in the field.

EXAMINE (when visible): house style/condition, yard maintenance, fencing, flags, lawn signs (even if text is unreadable), vehicles (type, age, bumper stickers), boats/RVs, children's toys/bikes, sports equipment, religious yard decor, garden style, neighborhood density cues, commercial vs residential character.

YOU MAY:
- Apply socioeconomic and cultural stereotypes commonly used in political targeting research (e.g. pickup vs hybrid, dense toys vs empty yard, pride/MAGA/Gadsden flags, church signage, "coexist" decor, etc.).
- Reason probabilistically from visible cues — be explicit about which cues drove the label.
- Assign Left, Right, Independent, or Undetermined with confidence.

YOU MUST:
- Ground every claim in something actually visible or clearly implied by visible objects (e.g. "plastic playset in front yard" — do not invent a playset).
- List cues in visible_cues before inferring lean.
- Put stereotype logic in stereotype_factors_used and inference_reasoning so a professor can validate or reject each step.
- Use Undetermined when the image is too obstructed or cues are genuinely ambiguous.

DO NOT:
- Claim to see people or infer race/ethnicity from human appearance (people are rarely visible; if present, ignore demographics).
- Invent objects not supported by the image.

Return ONLY valid JSON — no markdown fences.`;

const STRICT_JSON_SCHEMA = `{
  "scene_summary": "brief neutral description of what is visible",
  "visible_signals": ["only explicit political signage/text visible in the image"],
  "lean_street_view": "Left" | "Right" | "Independent" | "Undetermined",
  "lean_street_view_confidence": 0 to 100,
  "evidence": ["human-readable strings tied to visible signage only"],
  "imagery_quality": "clear" | "partial" | "obstructed" | "none"
}`;

const EXPLORATORY_JSON_SCHEMA = `{
  "scene_summary": "detailed description of residence, yard, vehicles, objects visible",
  "visible_cues": ["neutral observable facts only — e.g. 'white pickup in driveway', 'trampoline in side yard'"],
  "inference_reasoning": ["step-by-step reasoning from cues to lean hypothesis"],
  "stereotype_factors_used": ["named heuristic buckets you applied, e.g. 'rural SFH + pickup truck heuristic'"],
  "visible_signals": ["any legible political text/signs; may be empty"],
  "lean_street_view": "Left" | "Right" | "Independent" | "Undetermined",
  "lean_street_view_confidence": 0 to 100,
  "evidence": ["summary strings a researcher could verify on a follow-up visit"],
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

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter((s) => s.trim().length > 0);
}

function parseLean(parsed: Record<string, unknown>): LeanLabel {
  const candidate = parsed.lean_street_view ?? parsed.lean;
  return LEAN_LABELS.includes(candidate as LeanLabel) ? (candidate as LeanLabel) : 'Undetermined';
}

function parseImageryQuality(raw: unknown): StreetViewVisionPayload['imagery_quality'] {
  return ['clear', 'partial', 'obstructed', 'none'].includes(String(raw))
    ? (raw as StreetViewVisionPayload['imagery_quality'])
    : 'partial';
}

function parseVisionPayload(text: string): StreetViewVisionPayload {
  const parsed = parseJsonObject(text);

  return {
    scene_summary: String(parsed.scene_summary ?? ''),
    visible_signals: parseStringArray(parsed.visible_signals),
    lean_street_view: parseLean(parsed),
    lean_street_view_confidence: clamp(
      Math.round(Number(parsed.lean_street_view_confidence ?? parsed.confidence ?? 0)),
      0,
      100,
    ),
    evidence: parseStringArray(parsed.evidence),
    imagery_quality: parseImageryQuality(parsed.imagery_quality),
  };
}

function parseExploratoryPayload(text: string): StreetViewExploratoryPayload {
  const base = parseVisionPayload(text);
  const parsed = parseJsonObject(text);
  return {
    ...base,
    visible_cues: parseStringArray(parsed.visible_cues),
    inference_reasoning: parseStringArray(parsed.inference_reasoning),
    stereotype_factors_used: parseStringArray(parsed.stereotype_factors_used),
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

export function applyExploratoryGuardrails(
  payload: StreetViewExploratoryPayload,
): StreetViewExploratoryPayload {
  const hasCues =
    payload.visible_cues.length > 0 ||
    payload.visible_signals.length > 0 ||
    payload.scene_summary.trim().length > 0;

  if (!hasCues) {
    return {
      ...payload,
      lean_street_view: 'Undetermined',
      lean_street_view_confidence: 0,
    };
  }

  if (payload.lean_street_view === 'Undetermined') {
    return {
      ...payload,
      lean_street_view_confidence: Math.min(payload.lean_street_view_confidence, 25),
    };
  }

  return {
    ...payload,
    lean_street_view_confidence: Math.min(payload.lean_street_view_confidence, 80),
  };
}

function methodologyNote(mode: StreetViewVisionMode): string {
  if (mode === 'exploratory') {
    return (
      'EXPLORATORY Street View lean — stereotype/heuristic inference from visible cues. ' +
      'NOT merged into OSINT lean. For professor validation against field research only.'
    );
  }
  return (
    'STRICT Street View lean — visible political signage only. ' +
    'NOT merged into main OSINT lean. Guardrails require visible_signals for labeled lean.'
  );
}

function emptyResult(
  mode: StreetViewVisionMode,
  status: StreetViewVisionStatus,
  address: string | null,
  error_message?: string,
): StreetViewVisionResult {
  return {
    vision_mode: mode,
    status,
    address_used: address,
    street_view_preview: null,
    lean_street_view: 'Undetermined',
    lean_street_view_confidence: 0,
    visible_signals: [],
    scene_summary: '',
    evidence: [],
    imagery_quality: 'none',
    methodology_note: methodologyNote(mode),
    usage: null,
    error_message,
  };
}

function mapFetchStatus(fetch: StreetViewFetchResult): StreetViewVisionStatus {
  if (fetch.status === 'api_unconfigured') return 'google_unconfigured';
  return fetch.status;
}

function buildUserPrompt(
  bundle: EnrichmentBundle,
  address: string,
  mode: StreetViewVisionMode,
): string {
  const schema = mode === 'exploratory' ? EXPLORATORY_JSON_SCHEMA : STRICT_JSON_SCHEMA;
  const modeNote =
    mode === 'exploratory'
      ? `EXPLORATORY MODE: infer lean from all visible residence/yard/vehicle/object cues. Be explicit about stereotypes and reasoning. Florida NPA voter in ${bundle.anchor.city}, precinct ${bundle.anchor.precinct}, county ${bundle.anchor.county_code}.`
      : `STRICT MODE: political signage only. Address context — judge ONLY the image.`;

  return `${modeNote}

Residence address (geocode used for this panorama):
${address}

Return JSON:
${schema}`;
}

function toResult(
  mode: StreetViewVisionMode,
  address: string,
  imageDataUrl: string,
  parsed: StreetViewVisionPayload | StreetViewExploratoryPayload,
  usage: XaiUsageSummary | null,
): StreetViewVisionResult {
  const exploratory = mode === 'exploratory' ? (parsed as StreetViewExploratoryPayload) : null;

  return {
    vision_mode: mode,
    status: 'ok',
    address_used: address,
    street_view_preview: imageDataUrl,
    lean_street_view: parsed.lean_street_view,
    lean_street_view_confidence: parsed.lean_street_view_confidence,
    visible_signals: parsed.visible_signals,
    scene_summary: parsed.scene_summary,
    evidence: parsed.evidence,
    imagery_quality: parsed.imagery_quality,
    visible_cues: exploratory?.visible_cues,
    inference_reasoning: exploratory?.inference_reasoning,
    stereotype_factors_used: exploratory?.stereotype_factors_used,
    methodology_note: methodologyNote(mode),
    usage,
  };
}

export function parseStreetViewVisionMode(value: unknown): StreetViewVisionMode {
  return value === 'exploratory' ? 'exploratory' : 'strict';
}

export async function runStreetViewVisionTest(
  bundle: EnrichmentBundle,
  mode: StreetViewVisionMode = 'strict',
): Promise<StreetViewVisionResult> {
  const residence = bundle.residence_on_file;
  const fetch = await fetchStreetViewImage(residence);

  if (fetch.status !== 'ok' || !fetch.image_bytes) {
    return emptyResult(
      mode,
      mapFetchStatus(fetch),
      fetch.address_used,
      fetch.error_message,
    );
  }

  const imageDataUrl = streetViewImageDataUrl(fetch.image_bytes);
  const systemPrompt =
    mode === 'exploratory' ? EXPLORATORY_SYSTEM_PROMPT : STRICT_SYSTEM_PROMPT;
  const userPrompt = buildUserPrompt(bundle, fetch.address_used!, mode);

  const response = await xaiResponsesWithVision({
    model: getXaiModel(),
    systemPrompt,
    userText: userPrompt,
    imageUrl: imageDataUrl,
    detail: 'high',
  });

  if (mode === 'exploratory') {
    const parsed = applyExploratoryGuardrails(parseExploratoryPayload(response.text));
    return toResult(mode, fetch.address_used!, imageDataUrl, parsed, response.usage);
  }

  const parsed = applyStreetViewGuardrails(parseVisionPayload(response.text));
  return toResult(mode, fetch.address_used!, imageDataUrl, parsed, response.usage);
}