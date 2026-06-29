export interface FlContributionRow {
  contributor_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip5: string | null;
  amount: number | null;
  contribution_date: string | null;
  committee_name: string | null;
  contribution_type: string | null;
  occupation: string | null;
}

export interface FlContributionHit extends FlContributionRow {
  id: string;
  snapshot_id: string;
}