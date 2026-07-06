import { normalizeCity, zip5 } from '@/lib/reference-data/normalize';
import { addressCorroboration, isAddressCorroborated } from '@/lib/reference-data/address-match';
import { officerNameNorm } from '@/lib/sunbiz/parse-cor';
import type { FecIdentityBand } from '@/lib/fec/identity-match';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { PoolClient } from 'pg';

export interface SunbizOfficerHit {
  id: string;
  snapshot_id: string;
  corp_number: string;
  corp_name: string;
  corp_status: string | null;
  filing_type: string | null;
  officer_title: string | null;
  officer_name: string;
  officer_city: string | null;
  officer_zip5: string | null;
  officer_address: string | null;
  match_score: number;
  match_reasons: string[];
}

/** Quarter prefix from labels like `2026q2-cor3` → `2026q2`. */
function sunbizQuarterPrefix(label: string): string {
  const m = label.match(/^(.+)-cor\d+$/);
  return m?.[1] ?? label;
}

export async function getActiveSunbizSnapshotIds(
  client: PoolClient,
): Promise<string[]> {
  const latest = await client.query<{ label: string }>(
    `SELECT label FROM reference_snapshots
     WHERE source = 'sunbiz_cor'
     ORDER BY imported_at DESC
     LIMIT 1`,
  );
  const label = latest.rows[0]?.label;
  if (!label) return [];

  const prefix = sunbizQuarterPrefix(label);
  const res = await client.query<{ id: string }>(
    `SELECT id FROM reference_snapshots
     WHERE source = 'sunbiz_cor'
       AND (label = $1 OR label LIKE $2)
     ORDER BY label`,
    [label, `${prefix}-cor%`],
  );
  return res.rows.map((r) => r.id);
}

/** Latest single snapshot id (legacy); prefer getActiveSunbizSnapshotIds for sharded cor imports. */
export async function getActiveSunbizSnapshotId(
  client: PoolClient,
): Promise<string | null> {
  const ids = await getActiveSunbizSnapshotIds(client);
  return ids[ids.length - 1] ?? null;
}

/** Sunbiz band from a gated match score — kept in one place for the event builder. */
export function sunbizIdentityBand(score: number): FecIdentityBand {
  return score >= 0.75 ? 'confirmed' : score >= 0.55 ? 'probable' : 'ambiguous';
}

/**
 * Score a voter against one officer row. ENH-012: street-address corroboration
 * is a HARD GATE — a name+zip collision against 20.6M officers can no longer
 * reach the settle-capable bands. Only when the officer's `officer_address`
 * matches the voter's own street (`house_and_street`/`exact`) does the score
 * clear 0.55 (probable). Missing address on either side degrades to `unknown`
 * (never a penalty), which still caps at `ambiguous` — evidence, never a settle.
 */
export function scoreSunbizOfficerMatch(
  voter: ParsedFlVoterRecord,
  row: Omit<SunbizOfficerHit, 'match_score' | 'match_reasons'>,
): { score: number; reasons: string[]; corroboration: string } {
  const reasons: string[] = [];
  let score = 0.2;

  const vLast = voter.name.last.toLowerCase();
  const vFirst = voter.name.first.toLowerCase();
  const oParts = row.officer_name.toLowerCase().split(/\s+/).filter(Boolean);
  const oLast = oParts[oParts.length - 1] ?? '';
  const oFirst = oParts[0] ?? '';

  if (vLast && oLast === vLast) {
    score += 0.2;
    reasons.push('last_name_match');
  }
  if (vFirst && oFirst === vFirst) {
    score += 0.15;
    reasons.push('first_name_match');
  }

  const voterZip = zip5(voter.residence.zip);
  const officerZip = row.officer_zip5 ?? '';
  if (voterZip && officerZip) {
    if (voterZip === officerZip) {
      score += 0.3;
      reasons.push('zip5_match');
    } else {
      score -= 0.15;
      reasons.push('zip5_mismatch');
    }
  }

  const voterCity = normalizeCity(voter.residence.city);
  const officerCity = normalizeCity(row.officer_city ?? '');
  if (voterCity && officerCity && voterCity === officerCity) {
    score += 0.15;
    reasons.push('city_match');
  }

  const corroboration = addressCorroboration(voter.residence.line1, row.officer_address);
  if (isAddressCorroborated(corroboration)) {
    score += 0.25;
    reasons.push('address_match');
  } else if (corroboration === 'partial') {
    score += 0.05;
    reasons.push('address_partial');
  } else if (corroboration === 'mismatch') {
    score -= 0.25;
    reasons.push('address_mismatch');
  }

  score = Math.min(1, Math.max(0, score));
  // Hard gate: without a corroborated street, cap below the 0.55 'probable'
  // line so name+zip collisions land at 'ambiguous' and can never settle.
  if (!isAddressCorroborated(corroboration)) {
    score = Math.min(score, 0.54);
    reasons.push('uncorroborated_cap');
  }

  return { score, reasons, corroboration };
}

export async function lookupSunbizOfficersForVoter(params: {
  client: PoolClient;
  snapshotIds: string[];
  voter: ParsedFlVoterRecord;
  limit?: number;
}): Promise<SunbizOfficerHit[]> {
  if (params.snapshotIds.length === 0) return [];

  const lastNorm = officerNameNorm(params.voter.name.last);
  const voterZip = zip5(params.voter.residence.zip);
  const limit = params.limit ?? 20;

  // Two explicit shapes instead of an ($x = '' OR col = $x) optional param —
  // the OR disjunct blocks the (snapshot_id, officer_zip5) index (DEF-007/008).
  // Zip-present (every FL-extract voter) probes the index and LIKE-filters the
  // few hundred same-zip rows in memory; the zip-less fallback (generic intake
  // rows without a zip) still scans and stays capped by LIMIT.
  const res = voterZip
    ? await params.client.query<Omit<SunbizOfficerHit, 'match_score' | 'match_reasons'>>(
        `SELECT id, snapshot_id, corp_number, corp_name, corp_status, filing_type,
                officer_title, officer_name, officer_city, officer_zip5, officer_address
         FROM sunbiz_officers
         WHERE snapshot_id = ANY($1::uuid[])
           AND officer_zip5 = $2
           AND officer_name_norm LIKE '%' || $3 || '%'
         LIMIT $4`,
        [params.snapshotIds, voterZip, lastNorm, limit],
      )
    : await params.client.query<Omit<SunbizOfficerHit, 'match_score' | 'match_reasons'>>(
        `SELECT id, snapshot_id, corp_number, corp_name, corp_status, filing_type,
                officer_title, officer_name, officer_city, officer_zip5, officer_address
         FROM sunbiz_officers
         WHERE snapshot_id = ANY($1::uuid[])
           AND officer_name_norm LIKE '%' || $2 || '%'
         LIMIT $3`,
        [params.snapshotIds, lastNorm, limit],
      );

  const scored = res.rows.map((row) => {
    const { score, reasons } = scoreSunbizOfficerMatch(params.voter, row);
    return { ...row, match_score: score, match_reasons: reasons };
  });

  scored.sort((a, b) => b.match_score - a.match_score);
  return scored.filter((r) => r.match_score >= 0.45);
}