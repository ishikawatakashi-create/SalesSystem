/**
 * 対応履歴ドメイン公開面。
 */
export type {
  ActivityWriteInput,
  ActivityCreateCommand,
  ActivityUpdateCommand,
  ActivityWriteResult,
  ActivityCreateResult,
  ActivityUpdateResult,
  ActivityBulkCreateInput,
  ActivityBulkCreateRowInput,
  ActivityBulkCreateResult,
  ActivityBulkCreateRowResult,
  ActivityIndexRow,
  ActivityDetail,
  ActivityListQuery,
  ActivityRecoveryPayload,
  WriteOperationRow,
} from "@/lib/activities/types";

export {
  hashActivityWriteInput,
  sanitizeActivityWriteInput,
  canonicalizeActivityWriteInput,
} from "@/lib/activities/input-hash";

export {
  hashActivityDomain,
  hashActivityWriteWithExternalId,
} from "@/lib/activities/content-hash";

export {
  activityDomainToIndexRow,
  ACTIVITY_INDEX_FIELD_MAP,
} from "@/lib/activities/index-mapper";

export {
  selectLatestActivity,
} from "@/lib/activities/recalculate-latest-activity";
