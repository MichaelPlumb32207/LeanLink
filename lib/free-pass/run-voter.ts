import { buildAnchorProfile } from '@/lib/anchor/profile';
import { householdForVoterRecord, loadUploadHouseholdIndex } from '@/lib/anchor/upload-index';
import { buildFlContribEvidenceEvent } from '@/lib/evidence/fl-contrib-events';
import { appendEvidenceEvent, deleteVoterArmEvents, fuseAndPersistVoter } from '@/lib/evidence/ledger';
import { buildHouseholdEvidenceEvent } from '@/lib/evidence/household-events';
import { buildSunbizEvidenceEvent } from '@/lib/evidence/sunbiz-events';
import { scoreFlContributionsAgainstVoter } from '@/lib/fl-contrib/identity-match';
import {
  lookupFlContributionsByContributor,
  lookupFlContributionsByEntityName,
} from '@/lib/fl-contrib/lookup';
import type { ResearcherCommitteeLabel } from '@/lib/committee-lean/infer';
import { buildNameSearchVariants, fecQueryNames } from '@/lib/anchor/name-variants';
import { parseEmailInsights } from '@/lib/enrichment/email-insights';
import { lookupSunbizOfficersForVoter } from '@/lib/sunbiz/lookup';
import { addressCorroboration, isAddressCorroborated } from '@/lib/reference-data/address-match';
import type { FreePassSteps } from '@/lib/free-pass/steps';
import { FREE_PASS_ALL } from '@/lib/free-pass/steps';
import type { LeanPatternSets } from '@/lib/lean-patterns/patterns';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { PoolClient } from 'pg';

export interface FreePassVoterResult {
  voter_record_id: string;
  events_written: number;
  fl_contrib_layer1: number;
  fl_contrib_layer2: number;
  sunbiz_hits: number;
}

async function snapshotLabel(
  client: PoolClient,
  snapshotId: string,
): Promise<string> {
  const res = await client.query<{ label: string }>(
    `SELECT label FROM reference_snapshots WHERE id = $1`,
    [snapshotId],
  );
  return res.rows[0]?.label ?? snapshotId;
}

export async function runFreePassForVoter(
  client: PoolClient,
  params: {
    upload_id: string;
    voter_record_id: string;
    user_id: string;
    voter: ParsedFlVoterRecord;
    flSnapshotId: string | null;
    sunbizSnapshotIds: string[];
    householdIndex: Awaited<ReturnType<typeof loadUploadHouseholdIndex>>;
    researcherLabels?: Map<string, ResearcherCommitteeLabel>;
    leanPatterns?: LeanPatternSets;
    steps?: FreePassSteps;
    /** Pass from FreePassContext to skip two per-voter label queries. */
    flLabel?: string;
    sunbizQuarterLabel?: string;
  },
): Promise<FreePassVoterResult> {
  const steps = params.steps ?? FREE_PASS_ALL;
  let events_written = 0;
  let fl_contrib_layer1 = 0;
  let fl_contrib_layer2 = 0;
  let sunbiz_hits = 0;

  const members = householdForVoterRecord(
    params.householdIndex,
    params.voter_record_id,
    params.voter,
  );
  const anchorProfile = buildAnchorProfile(params.voter, members, params.voter_record_id);
  const householdEvent = buildHouseholdEvidenceEvent({
    upload_id: params.upload_id,
    voter_record_id: params.voter_record_id,
    user_id: params.user_id,
    voter: params.voter,
    profile: anchorProfile,
  });
  if (steps.household && householdEvent) {
    await appendEvidenceEvent(client, householdEvent);
    events_written += 1;
  }

  if (steps.fl_contrib_l1 && params.flSnapshotId) {
    const flLabel = params.flLabel ?? (await snapshotLabel(client, params.flSnapshotId));
    const emailInsights = parseEmailInsights(params.voter.email, params.voter.name.full);
    const names = fecQueryNames(buildNameSearchVariants(params.voter, emailInsights), 3);

    const layer1Hits = [];
    for (const name of names) {
      const hits = await lookupFlContributionsByContributor({
        client,
        snapshotId: params.flSnapshotId,
        contributorName: name,
        city: params.voter.residence.city,
        zip5: params.voter.residence.zip,
      });
      layer1Hits.push(...hits);
    }
    const dedupedL1 = [...new Map(layer1Hits.map((h) => [h.id, h])).values()];

    const id1 = scoreFlContributionsAgainstVoter({
      voter: params.voter,
      hits: dedupedL1,
      match_layer: 1,
    });
    await appendEvidenceEvent(
      client,
      buildFlContribEvidenceEvent({
        upload_id: params.upload_id,
        voter_record_id: params.voter_record_id,
        user_id: params.user_id,
        identity: id1,
        hits: dedupedL1,
        match_layer: 1,
        snapshot_label: flLabel,
        researcher_labels: params.researcherLabels,
        lean_patterns: params.leanPatterns,
      }),
    );
    events_written += 1;
    fl_contrib_layer1 = dedupedL1.length;
  }

  let sunbizEntities: { corp_name: string }[] = [];
  if (steps.sunbiz && params.sunbizSnapshotIds.length > 0) {
    const quarterLabel =
      params.sunbizQuarterLabel ??
      (await snapshotLabel(client, params.sunbizSnapshotIds[0])).replace(/-cor\d+$/, '');
    const officers = await lookupSunbizOfficersForVoter({
      client,
      snapshotIds: params.sunbizSnapshotIds,
      voter: params.voter,
    });
    sunbiz_hits = officers.length;
    // ENH-012 per-person clustering: only officers whose street corroborates the
    // voter's own address bridge to layer-2. One person can officer several corps
    // at their address; a scatter of same-name+zip officers across many addresses
    // is the collision signature — it yields no bridge (that's the 98k noise).
    sunbizEntities = officers
      .filter((o) =>
        isAddressCorroborated(addressCorroboration(params.voter.residence.line1, o.officer_address)),
      )
      .map((o) => ({ corp_name: o.corp_name }));

    const sunbizEvent = buildSunbizEvidenceEvent({
      upload_id: params.upload_id,
      voter_record_id: params.voter_record_id,
      user_id: params.user_id,
      hits: officers,
      snapshot_label: quarterLabel,
    });
    if (sunbizEvent) {
      await appendEvidenceEvent(client, sunbizEvent);
      events_written += 1;
    } else {
      // No qualifying officer this pass — supersede any stale prior Sunbiz event
      // (e.g. a pre-ENH-012 name+zip collision that no longer clears the gate).
      await deleteVoterArmEvents(client, params.voter_record_id, 'sunbiz', 'sunbiz_index');
    }
  }

  if (steps.fl_contrib_l2 && params.flSnapshotId) {
    let wroteLayer2 = false;
    // Only address-corroborated officers produced sunbizEntities (ENH-012); if
    // none did, there is no bridge to build this pass.
    if (sunbizEntities.length > 0) {
      const flLabel = params.flLabel ?? (await snapshotLabel(client, params.flSnapshotId));
      const layer2Hits = [];
      for (const entity of sunbizEntities.slice(0, 3)) {
        const hits = await lookupFlContributionsByEntityName({
          client,
          snapshotId: params.flSnapshotId,
          entityName: entity.corp_name,
        });
        layer2Hits.push(...hits);
      }
      const dedupedL2 = [...new Map(layer2Hits.map((h) => [h.id, h])).values()];
      if (dedupedL2.length > 0) {
        const id2 = scoreFlContributionsAgainstVoter({
          voter: params.voter,
          hits: dedupedL2,
          match_layer: 2,
        });
        await appendEvidenceEvent(
          client,
          buildFlContribEvidenceEvent({
            upload_id: params.upload_id,
            voter_record_id: params.voter_record_id,
            user_id: params.user_id,
            identity: id2,
            hits: dedupedL2,
            match_layer: 2,
            snapshot_label: flLabel,
            entity_name: sunbizEntities[0]?.corp_name,
            researcher_labels: params.researcherLabels,
            lean_patterns: params.leanPatterns,
          }),
        );
        events_written += 1;
        fl_contrib_layer2 = dedupedL2.length;
        wroteLayer2 = true;
      }
    }
    if (!wroteLayer2) {
      // Bridge collapsed (no corroborated officer, or the corp made no FL
      // donations) — supersede any stale layer-2 event so an old entity lean
      // can't linger. Layer-1 (source fl_contrib_index) is untouched.
      await deleteVoterArmEvents(client, params.voter_record_id, 'fl_contrib', 'fl_contrib_entity');
    }
  }

  await fuseAndPersistVoter(
    client,
    params.voter_record_id,
    params.upload_id,
    params.user_id,
  );

  return {
    voter_record_id: params.voter_record_id,
    events_written,
    fl_contrib_layer1,
    fl_contrib_layer2,
    sunbiz_hits,
  };
}