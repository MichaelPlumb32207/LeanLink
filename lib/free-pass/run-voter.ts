import { buildAnchorProfile } from '@/lib/anchor/profile';
import { householdForVoterRecord, loadUploadHouseholdIndex } from '@/lib/anchor/upload-index';
import { buildFlContribEvidenceEvent } from '@/lib/evidence/fl-contrib-events';
import { appendEvidenceEvent, fuseAndPersistVoter } from '@/lib/evidence/ledger';
import { buildHouseholdEvidenceEvent } from '@/lib/evidence/household-events';
import { buildSunbizEvidenceEvent } from '@/lib/evidence/sunbiz-events';
import { scoreFlContributionsAgainstVoter } from '@/lib/fl-contrib/identity-match';
import {
  getActiveFlContribSnapshotId,
  lookupFlContributionsByContributor,
  lookupFlContributionsByEntityName,
} from '@/lib/fl-contrib/lookup';
import { buildNameSearchVariants, fecQueryNames } from '@/lib/anchor/name-variants';
import { parseEmailInsights } from '@/lib/enrichment/email-insights';
import {
  getActiveSunbizSnapshotId,
  lookupSunbizOfficersForVoter,
} from '@/lib/sunbiz/lookup';
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
    sunbizSnapshotId: string | null;
    householdIndex: Awaited<ReturnType<typeof loadUploadHouseholdIndex>>;
  },
): Promise<FreePassVoterResult> {
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
  if (householdEvent) {
    await appendEvidenceEvent(client, householdEvent);
    events_written += 1;
  }

  if (params.flSnapshotId) {
    const flLabel = await snapshotLabel(client, params.flSnapshotId);
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
      }),
    );
    events_written += 1;
    fl_contrib_layer1 = dedupedL1.length;
  }

  let sunbizEntities: { corp_name: string }[] = [];
  if (params.sunbizSnapshotId) {
    const sunbizLabel = await snapshotLabel(client, params.sunbizSnapshotId);
    const officers = await lookupSunbizOfficersForVoter({
      client,
      snapshotId: params.sunbizSnapshotId,
      voter: params.voter,
    });
    sunbiz_hits = officers.length;
    sunbizEntities = officers.map((o) => ({ corp_name: o.corp_name }));

    const sunbizEvent = buildSunbizEvidenceEvent({
      upload_id: params.upload_id,
      voter_record_id: params.voter_record_id,
      user_id: params.user_id,
      hits: officers,
      snapshot_label: sunbizLabel,
    });
    if (sunbizEvent) {
      await appendEvidenceEvent(client, sunbizEvent);
      events_written += 1;
    }
  }

  if (params.flSnapshotId && sunbizEntities.length > 0) {
    const flLabel = await snapshotLabel(client, params.flSnapshotId);
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
        }),
      );
      events_written += 1;
      fl_contrib_layer2 = dedupedL2.length;
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