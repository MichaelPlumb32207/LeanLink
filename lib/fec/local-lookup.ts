/**
 * Local FEC lookup against the bulk-loaded `fec_contributions` index — the
 * fast replacement for the throttled Open-API sweep. Produces the same
 * `FecContributionHit` shape the API path produces, so identity scoring
 * (`scoreFecLookupForVoter`) and donation-lean inference run unchanged.
 *
 * Matching: the index stores names in FEC's "LAST, FIRST MIDDLE" order,
 * normalized (suffixes stripped) to "last first middle". Voter-side keys are
 * built in the same order from the structured name plus the anchor name
 * variants, matched exact-first then indexed-prefix (`text_pattern_ops`).
 */
import type { PoolClient } from 'pg';
import { parseEmailInsights } from '@/lib/enrichment/email-insights';
import { buildNameSearchVariants, fecQueryNames } from '@/lib/anchor/name-variants';
import { fecNameNorm } from '@/lib/reference-data/normalize';
import type { FecContributionHit, FecMatchLevel } from '@/lib/fec/contributor-lookup';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

const HITS_PER_KEY = 25;
const MAX_KEYS = 4;

export interface FecIndexSnapshot {
  id: string;
  label: string;
}

/** Latest COMPLETED fec_indiv snapshot — in-progress loads are never matched. */
export async function getActiveFecIndivSnapshot(
  client: PoolClient,
): Promise<FecIndexSnapshot | null> {
  const res = await client.query<FecIndexSnapshot>(
    `SELECT id, label FROM reference_snapshots
     WHERE source = 'fec_indiv' AND completed_at IS NOT NULL
     ORDER BY imported_at DESC
     LIMIT 1`,
  );
  return res.rows[0] ?? null;
}

/** "First [Middle] Last" variant → "last first" index key (suffixes stripped). */
function variantToKey(variant: string): string {
  const tokens = fecNameNorm(variant).split(' ').filter(Boolean);
  if (tokens.length < 2) return '';
  const last = tokens[tokens.length - 1];
  const first = tokens[0];
  return `${last} ${first}`;
}

/** Lookup keys for a voter: structured last+first, then anchor name variants. */
export function fecIndexKeysForVoter(record: ParsedFlVoterRecord): string[] {
  const keys: string[] = [];
  const push = (k: string) => {
    if (k && k.split(' ').length >= 2 && !keys.includes(k)) keys.push(k);
  };

  push(fecNameNorm(`${record.name.last} ${record.name.first}`));

  const emailInsights = parseEmailInsights(record.email, record.name.full);
  for (const variant of fecQueryNames(buildNameSearchVariants(record, emailInsights), 3)) {
    push(variantToKey(variant));
  }
  return keys.slice(0, MAX_KEYS);
}

interface IndexRow {
  sub_id: string;
  receipt_date: string | null;
  amount: number | null;
  contributor_name: string | null;
  contributor_city: string | null;
  contributor_state: string | null;
  contributor_zip: string | null;
  contributor_employer: string | null;
  contributor_occupation: string | null;
  committee_name: string | null;
  committee_party: string | null;
}

export interface FecIndexLookupResult {
  contributions: FecContributionHit[];
  match_level: FecMatchLevel | 'none';
  names_tried: string[];
  committee_parties: Record<string, string>;
}

export async function lookupFecIndexForVoter(
  client: PoolClient,
  snapshotId: string,
  record: ParsedFlVoterRecord,
): Promise<FecIndexLookupResult> {
  const keys = fecIndexKeysForVoter(record);
  const seen = new Set<string>();
  const contributions: FecContributionHit[] = [];
  const committee_parties: Record<string, string> = {};

  const select = `
    SELECT sub_id::text AS sub_id,
           contribution_date::text AS receipt_date,
           amount,
           contributor_name,
           city AS contributor_city,
           state AS contributor_state,
           zip5 AS contributor_zip,
           employer AS contributor_employer,
           occupation AS contributor_occupation,
           committee_name,
           committee_party
    FROM fec_contributions
    WHERE snapshot_id = $1 AND `;

  const collect = (rows: IndexRow[]) => {
    for (const row of rows) {
      if (seen.has(row.sub_id)) continue;
      seen.add(row.sub_id);
      contributions.push({
        receipt_date: row.receipt_date,
        amount: row.amount != null ? Number(row.amount) : null,
        contributor_name: row.contributor_name,
        contributor_city: row.contributor_city,
        contributor_state: row.contributor_state,
        contributor_zip: row.contributor_zip,
        contributor_employer: row.contributor_employer,
        contributor_occupation: row.contributor_occupation,
        committee_name: row.committee_name,
        candidate_name: null,
        fec_url: `https://www.fec.gov/data/receipts/individual-contributions/?sub_id=${row.sub_id}`,
      });
      if (row.committee_name && row.committee_party) {
        committee_parties[row.committee_name] = row.committee_party;
      }
    }
  };

  // Exact matches for all keys in one round-trip.
  const exact = await client.query<IndexRow>(
    `${select} contributor_name_norm = ANY($2)
     ORDER BY contribution_date DESC NULLS LAST
     LIMIT $3`,
    [snapshotId, keys, HITS_PER_KEY * keys.length],
  );
  collect(exact.rows);

  // Prefix pass on the primary key catches middle names/initials in the file
  // ("smith john a") that the exact key ("smith john") misses.
  if (keys.length > 0) {
    const prefix = await client.query<IndexRow>(
      `${select} contributor_name_norm LIKE $2
       ORDER BY contribution_date DESC NULLS LAST
       LIMIT $3`,
      [snapshotId, `${keys[0]} %`, HITS_PER_KEY],
    );
    collect(prefix.rows);
  }

  return {
    contributions,
    match_level: contributions.length > 0 ? 'strict' : 'none',
    names_tried: keys,
    committee_parties,
  };
}
