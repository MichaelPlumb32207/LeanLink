import type { SunbizOfficerHit } from '@/lib/sunbiz/lookup';
import { sunbizIdentityBand } from '@/lib/sunbiz/lookup';
import { SCORER_VERSION } from '@/lib/evidence/scorer-version';
import type { EvidenceEventInput } from '@/lib/evidence/types';

export function buildSunbizEvidenceEvent(params: {
  upload_id: string;
  voter_record_id: string;
  user_id: string;
  hits: SunbizOfficerHit[];
  snapshot_label: string;
}): EvidenceEventInput | null {
  if (params.hits.length === 0) return null;

  const top = params.hits[0];
  const identity_band = sunbizIdentityBand(top.match_score);

  const evidence = params.hits.slice(0, 5).map((h) => {
    const addr = h.match_reasons.includes('address_match')
      ? 'address ✓'
      : h.match_reasons.includes('uncorroborated_cap')
        ? 'no address match'
        : 'address ?';
    return `Officer ${h.officer_title || '?'} of ${h.corp_name} (${h.filing_type || 'corp'}) — score ${Math.round(h.match_score * 100)}% · ${addr}`;
  });

  return {
    upload_id: params.upload_id,
    voter_record_id: params.voter_record_id,
    user_id: params.user_id,
    arm: 'sunbiz',
    source: 'sunbiz_index',
    identity_band,
    identity_score: top.match_score,
    probable_same_person: identity_band === 'confirmed' || identity_band === 'probable',
    lean_signal: 'Undetermined',
    lean_confidence: null,
    evidence,
    urls: [`https://search.sunbiz.org/Inquiry/CorporationSearch/ByName`],
    payload: {
      dedupe_key: 'sunbiz_index_v1',
      snapshot_label: params.snapshot_label,
      entities: params.hits.slice(0, 5).map((h) => ({
        corp_number: h.corp_number,
        corp_name: h.corp_name,
        officer_title: h.officer_title,
      })),
      scorer_v: SCORER_VERSION,
    },
    cost_usd: 0,
    dedupe_key: 'sunbiz_index_v1',
  };
}