import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export interface HouseholdMember {
  voter_record_id: string;
  row_index: number;
  voter_id: string;
  name_full: string;
  party: string;
  relationship_hint: 'co_resident';
}

/** Normalize residence line1 + zip5 for co-address clustering within an upload. */
export function residenceAddressKey(record: ParsedFlVoterRecord): string | null {
  const line1 = record.residence.line1?.trim().toLowerCase().replace(/[.,#]/g, '').replace(/\s+/g, ' ');
  const zip = record.residence.zip?.replace(/\D/g, '').slice(0, 5);
  if (!line1 || line1.length < 3 || !zip || zip.length < 5) return null;
  return `${line1}|${zip}`;
}

export function householdMembersExcludingSelf(
  members: HouseholdMember[],
  voterRecordId: string,
): HouseholdMember[] {
  return members.filter((m) => m.voter_record_id !== voterRecordId);
}