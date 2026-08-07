/**
 * クレームドメイン公開面。
 */
export type {
  ComplaintWriteInput,
  ComplaintCreateCommand,
  ComplaintUpdateCommand,
  ComplaintWriteResult,
  ComplaintCreateResult,
  ComplaintUpdateResult,
  ComplaintIndexRow,
  ComplaintDetail,
  ComplaintListQuery,
  ComplaintRecoveryPayload,
  ComplaintStatusSemantic,
  WriteOperationRow,
} from "@/lib/complaints/types";

export {
  COMPLAINT_STATUS_SEMANTICS,
  COMPLAINT_DONE_SEMANTIC,
  isComplaintUnresolved,
  isComplaintDoneSemantic,
} from "@/lib/complaints/types";

export {
  hashComplaintWriteInput,
  sanitizeComplaintWriteInput,
  canonicalizeComplaintWriteInput,
} from "@/lib/complaints/input-hash";

export {
  hashComplaintDomain,
  hashComplaintWriteWithExternalId,
} from "@/lib/complaints/content-hash";

export {
  complaintDomainToIndexRow,
  COMPLAINT_INDEX_FIELD_MAP,
} from "@/lib/complaints/index-mapper";
