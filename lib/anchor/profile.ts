import { parseEmailInsights } from '@/lib/enrichment/email-insights';
import {
  buildNameSearchVariants,
  fecQueryNames,
  type NameSearchVariant,
} from '@/lib/anchor/name-variants';
import {
  householdMembersExcludingSelf,
  type HouseholdMember,
} from '@/lib/anchor/household';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export interface AnchorProfile {
  name_variants: NameSearchVariant[];
  fec_query_names: string[];
  household_members: HouseholdMember[];
  notes: string[];
}

export function buildAnchorProfile(
  record: ParsedFlVoterRecord,
  householdMembers: HouseholdMember[],
  voterRecordId?: string,
): AnchorProfile {
  const emailInsights = parseEmailInsights(record.email, record.name.full);
  const name_variants = buildNameSearchVariants(record, emailInsights);
  const coResidents = voterRecordId
    ? householdMembersExcludingSelf(householdMembers, voterRecordId)
    : householdMembers;

  const notes: string[] = [];
  if (emailInsights.insight_note) notes.push(emailInsights.insight_note);
  if (name_variants.length > 1) {
    notes.push(
      `${name_variants.length - 1} alternate search name(s) for FEC/OSINT retrieval (not identity claims).`,
    );
  }
  if (coResidents.length > 0) {
    notes.push(
      `${coResidents.length} co-resident(s) at ${record.residence.line1}, ${record.residence.zip}.`,
    );
  }

  return {
    name_variants,
    fec_query_names: fecQueryNames(name_variants),
    household_members: coResidents,
    notes,
  };
}