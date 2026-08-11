export const PROSPECT_LIST_STATUSES = [
  "draft",
  "active",
  "paused",
  "archived",
] as const;
export type ProspectListStatus = (typeof PROSPECT_LIST_STATUSES)[number];

export const PROSPECT_SOURCE_TYPES = [
  "vendor",
  "scraping",
  "event",
  "manual",
  "csv",
  "other",
] as const;
export type ProspectSourceType = (typeof PROSPECT_SOURCE_TYPES)[number];

export const PROSPECT_MEMBERSHIP_STAGES = [
  "new",
  "assigned",
  "working",
  "qualified",
  "disqualified",
  "converted",
] as const;
export type ProspectMembershipStage =
  (typeof PROSPECT_MEMBERSHIP_STAGES)[number];

export const MANUAL_PROSPECT_MEMBERSHIP_STAGES: readonly Exclude<
  ProspectMembershipStage,
  "converted"
>[] = PROSPECT_MEMBERSHIP_STAGES.filter(
  (stage): stage is Exclude<ProspectMembershipStage, "converted"> =>
    stage !== "converted",
);

export const PROSPECT_STAGE_LABELS: Record<ProspectMembershipStage, string> = {
  new: "未着手",
  assigned: "割当済",
  working: "対応中",
  qualified: "見込あり",
  disqualified: "対象外",
  converted: "正式組織化済み",
};

export const PROSPECT_PROMOTION_STATUSES = [
  "none",
  "pending",
  "organization_created",
  "contacts_done",
  "activity_done",
  "action_done",
  "completed",
  "failed",
] as const;
export type ProspectPromotionStatus =
  (typeof PROSPECT_PROMOTION_STATUSES)[number];

export const DUPLICATE_REVIEW_STATUSES = [
  "none",
  "probable",
  "reviewed_keep",
  "reviewed_merge",
] as const;
export type DuplicateReviewStatus = (typeof DUPLICATE_REVIEW_STATUSES)[number];

export const PROSPECT_IMPORT_ROW_STATUSES = [
  "pending",
  "accepted",
  "reused",
  "probable_duplicate",
  "invalid",
  "skipped",
  "failed",
] as const;
export type ProspectImportRowStatus =
  (typeof PROSPECT_IMPORT_ROW_STATUSES)[number];

export type ProspectListRow = {
  id: string;
  name: string;
  description: string | null;
  status: ProspectListStatus;
  source_type: ProspectSourceType;
  source_name: string | null;
  owner_user_id: string | null;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ProspectRow = {
  id: string;
  company_name: string;
  normalized_company_name: string;
  website_url: string | null;
  normalized_domain: string | null;
  main_phone: string | null;
  normalized_phone: string | null;
  postal_code: string | null;
  prefecture: string | null;
  city: string | null;
  address: string | null;
  industry: string | null;
  employee_range: string | null;
  description: string | null;
  notes: string | null;
  do_not_contact: boolean;
  do_not_contact_reason: string | null;
  do_not_contact_at: string | null;
  duplicate_review_status: DuplicateReviewStatus;
  formal_org_match_page_id: string | null;
  formal_org_match_external_id: string | null;
  formal_org_match_confidence: "high" | "probable" | null;
  promotion_status: ProspectPromotionStatus;
  promoted_customer_page_id: string | null;
  promoted_customer_external_id: string | null;
  promoted_at: string | null;
  promoted_by: string | null;
  promotion_error: string | null;
  promotion_request_id: string | null;
  phone_invalid: boolean;
  search_text: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ProspectContactRow = {
  id: string;
  prospect_id: string;
  name: string;
  normalized_name: string;
  department: string | null;
  title: string | null;
  email: string | null;
  normalized_email: string | null;
  phone: string | null;
  normalized_phone: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ProspectListMembershipRow = {
  id: string;
  prospect_list_id: string;
  prospect_id: string;
  assigned_user_id: string | null;
  stage: ProspectMembershipStage;
  priority: string | null;
  source_record_id: string | null;
  source_row_hash: string | null;
  source_attributes: Record<string, unknown>;
  notes: string | null;
  next_contact_at: string | null;
  last_contact_at: string | null;
  last_call_result: string | null;
  call_count: number;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ProspectListStats = {
  prospect_list_id: string;
  total_count: number;
  unassigned_count: number;
  assigned_count: number;
  working_count: number;
  qualified_count: number;
  disqualified_count: number;
  dnc_count: number;
  duplicate_review_count: number;
};

/** CSV staging row (mapped) */
export type ProspectStagedRow = {
  companyName: string;
  websiteUrl: string | null;
  domain: string | null;
  mainPhone: string | null;
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  address: string | null;
  industry: string | null;
  employeeRange: string | null;
  contactName: string | null;
  contactDepartment: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  externalRecordId: string | null;
  notes: string | null;
  sourceAttributes: Record<string, unknown>;
};
