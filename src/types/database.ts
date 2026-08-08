/**
 * Supabaseテーブルの型定義。
 * Phase 1基盤確定後は `supabase gen types` による自動生成へ移行する。
 */

export type AppRole = "admin" | "a" | "b" | "viewer";

export type ProvisioningStatus =
  | "pending"
  | "auth_created"
  | "profile_created"
  | "completed"
  | "failed";

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export type SyncStatus =
  | "synced"
  | "pending"
  | "error"
  | "delete_pending"
  | "excluded";

export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WriteOpStatus = "pending" | "notion_done" | "completed" | "failed";

export type ImportRowStatus =
  | "pending"
  | "valid_new"
  | "valid_update"
  | "duplicate"
  | "invalid"
  | "skipped"
  | "importing"
  | "imported"
  | "import_failed";

export type ImportJobStatus =
  | "pending"
  | "uploaded"
  | "analyzing"
  | "mapping_required"
  | "validating"
  | "validation_completed"
  | "ready"
  | "importing"
  | "partially_completed"
  | "completed"
  | "cancelled"
  | "failed";

export type ImportJobRow = {
  id: string;
  job_id: string | null;
  file_name: string | null;
  storage_path: string;
  file_size: number | null;
  sha256: string | null;
  expires_at: string;
  deleted_at: string | null;
  encoding: string | null;
  row_count: number | null;
  column_mapping: Record<string, unknown> | null;
  status: string;
  summary: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  entity_type: string | null;
  import_mode: string | null;
  source_key_field: string | null;
  source_system: string | null;
  detected_encoding: string | null;
  cancel_requested_at: string | null;
  last_processed_at: string | null;
  preview_summary: Record<string, unknown> | null;
  default_decision: string | null;
  mapping_aliases: Record<string, unknown> | null;
};

export type ImportRowRow = {
  id: string;
  import_job_id: string;
  row_number: number;
  external_id: string | null;
  status: ImportRowStatus;
  raw: Record<string, unknown> | null;
  normalized: Record<string, unknown> | null;
  match_reason: string | null;
  matched_page_id: string | null;
  error_message: string | null;
  source_key: string | null;
  source_key_hash: string | null;
  reason_codes: Record<string, unknown>;
  decision: string | null;
  retry_count: number;
  notion_page_id: string | null;
  staged: Record<string, unknown> | null;
};

// 注: supabase-jsの型制約(Record<string, unknown>)を満たすため、
// interfaceではなくtypeエイリアスで定義すること。
export type AppUserRow = {
  id: string;
  email: string;
  display_name: string;
  role: AppRole;
  department_role: string | null;
  is_active: boolean;
  provisioning_status: ProvisioningStatus;
  provisioning_error: string | null;
  notion_staff_page_id: string | null;
  invitation_id: string | null;
  created_at: string;
  updated_at: string;
};

export type UserInvitationRow = {
  id: string;
  email: string;
  normalized_email: string;
  display_name: string;
  role: AppRole;
  status: InvitationStatus;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type JobRow = {
  id: string;
  kind: string;
  priority: number;
  status: JobStatus;
  payload: Record<string, unknown>;
  progress_done: number;
  progress_total: number | null;
  cursor: Record<string, unknown> | null;
  idempotency_key: string | null;
  locked_by: string | null;
  locked_at: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

export type NotionRateLimiterRow = {
  id: number;
  next_slot_at: string;
  blocked_until: string | null;
  min_interval_ms: number;
};

export type SystemSettingRow = {
  key: string;
  value: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string;
};

export type MastersCacheRow = {
  notion_page_id: string;
  external_id: string | null;
  content_hash: string | null;
  notion_last_edited_at: string | null;
  sync_status: SyncStatus;
  sync_error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  master_type: string;
  name: string;
  semantic_key: string | null;
  semantic_tags: string[];
  sort_order: number | null;
  color: string | null;
  is_active: boolean;
  applicable_category_ids: string[];
};

export type AuditLogRow = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  notion_page_id: string | null;
  changed_fields: Record<string, unknown> | null;
  operation_source: string | null;
  request_id: string | null;
  batch_id: string | null;
  created_at: string;
};

export type CustomerIndexRow = {
  notion_page_id: string;
  external_id: string | null;
  content_hash: string | null;
  notion_last_edited_at: string | null;
  sync_status: SyncStatus;
  sync_error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  display_name: string;
  legal_name: string | null;
  office_name: string | null;
  postal_code: string | null;
  prefecture: string | null;
  city: string | null;
  address_line: string | null;
  /** 表示用電話番号原文 */
  phone: string | null;
  /** 検索用(数字のみ) */
  phone_normalized: string | null;
  email: string | null;
  representative_name: string | null;
  website: string | null;
  business_category_ids: string[];
  tag_ids: string[];
  relationship_ids: string[];
  relationship_semantic_keys: string[];
  sales_status_id: string | null;
  acquisition_route_id: string | null;
  priority_id: string | null;
  staff_user_ids: string[];
  latest_activity_summary: string | null;
  last_activity_at: string | null;
  next_action: string | null;
  next_action_date: string | null;
  expected_amount: number | null;
  is_archived: boolean;
  search_text: string;
  search_text_kana: string;
};

export type ContactIndexRow = {
  notion_page_id: string;
  external_id: string | null;
  content_hash: string | null;
  notion_last_edited_at: string | null;
  sync_status: SyncStatus;
  sync_error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  name: string;
  name_kana: string | null;
  customer_page_id: string | null;
  department: string | null;
  title: string | null;
  /** 表示用電話番号原文 */
  phone: string | null;
  /** 検索用(数字のみ) */
  phone_normalized: string | null;
  email: string | null;
  contact_type_id: string | null;
  note: string | null;
  is_active: boolean;
  search_text: string;
};

export type DealIndexRow = {
  notion_page_id: string;
  external_id: string | null;
  content_hash: string | null;
  notion_last_edited_at: string | null;
  sync_status: SyncStatus;
  sync_error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  customer_page_id: string | null;
  contact_page_ids: string[];
  business_category_id: string | null;
  product_name: string | null;
  stage_id: string | null;
  status_id: string | null;
  status_semantic: string | null;
  staff_user_ids: string[];
  staff_page_ids: string[];
  expected_amount: number | null;
  contract_amount: number | null;
  probability: number | null;
  expected_close_date: string | null;
  contracted_at: string | null;
  period_start: string | null;
  period_end: string | null;
  next_action: string | null;
  next_action_date: string | null;
  lost_reason: string | null;
  note: string | null;
  search_text: string;
};

export type ActivityIndexRow = {
  notion_page_id: string;
  external_id: string | null;
  content_hash: string | null;
  notion_last_edited_at: string | null;
  sync_status: SyncStatus;
  sync_error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  summary: string | null;
  body_hash: string | null;
  customer_page_id: string | null;
  deal_page_id: string | null;
  contact_page_ids: string[];
  activity_at: string | null;
  category_ids: string[];
  created_by: string | null;
  created_by_name: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  batch_id: string | null;
  search_text: string;
};

export type ActionIndexRow = {
  notion_page_id: string;
  external_id: string | null;
  content_hash: string | null;
  notion_last_edited_at: string | null;
  sync_status: SyncStatus;
  sync_error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  customer_page_id: string;
  deal_page_id: string | null;
  activity_page_id: string | null;
  assignee_user_id: string | null;
  staff_page_id: string | null;
  due_date: string | null;
  status_id: string | null;
  is_open: boolean;
  priority_id: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  search_text: string;
};

export type ContractIndexRow = {
  notion_page_id: string;
  external_id: string | null;
  content_hash: string | null;
  notion_last_edited_at: string | null;
  sync_status: SyncStatus;
  sync_error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  customer_page_id: string | null;
  deal_page_id: string | null;
  contract_type_id: string | null;
  trade_type_id: string | null;
  amount: number | null;
  contracted_at: string | null;
  start_date: string | null;
  end_date: string | null;
  auto_renew: boolean;
  billing_terms: string | null;
  payment_status_id: string | null;
  status_id: string | null;
  status_semantic: string | null;
  staff_user_ids: string[];
  staff_page_ids: string[];
  has_contract_url: boolean;
  has_contract_file: boolean;
  note: string | null;
  search_text: string;
};

export type ComplaintIndexRow = {
  notion_page_id: string;
  external_id: string | null;
  content_hash: string | null;
  notion_last_edited_at: string | null;
  sync_status: SyncStatus;
  sync_error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  summary: string | null;
  body_hash: string | null;
  customer_page_id: string | null;
  deal_page_id: string | null;
  occurred_on: string | null;
  severity_id: string | null;
  assignee_user_id: string | null;
  staff_page_id: string | null;
  due_date: string | null;
  status_id: string | null;
  status_semantic: string | null;
  completed_on: string | null;
  note: string | null;
  search_text: string;
};

export type WriteOperationRow = {
  request_id: string;
  entity_type: string;
  operation: string;
  external_id: string;
  input_hash: string;
  status: WriteOpStatus;
  notion_page_id: string | null;
  recovery_payload: Record<string, unknown> | null;
  actor_id: string | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
};

export type SyncErrorRow = {
  id: string;
  stage: string;
  entity_type: string | null;
  notion_page_id: string | null;
  external_id: string | null;
  message: string;
  detail: Record<string, unknown> | null;
  resolved_at: string | null;
  ignored_at: string | null;
  created_at: string;
};

export type InquiryStatus = "new" | "in_progress" | "done" | "no_action";

export type InquiryRow = {
  id: string;
  source: string;
  source_message_id: string;
  source_thread_id: string | null;
  received_at: string;
  subject: string | null;
  sender_name: string | null;
  sender_email: string | null;
  reply_to_email: string | null;
  phone: string | null;
  phone_normalized: string | null;
  company_name: string | null;
  form_name: string | null;
  message_text: string | null;
  form_fields: Record<string, unknown>;
  attachment_meta: Array<Record<string, unknown>>;
  status: InquiryStatus;
  assigned_user_id: string | null;
  linked_customer_page_id: string | null;
  linked_contact_page_id: string | null;
  linked_activity_page_id: string | null;
  handled_at: string | null;
  no_action_reason: string | null;
  parse_status: string;
  parse_warning_code: string | null;
  source_confidence: string;
  historical_import: boolean;
  parser_version: number;
  ingest_classification: string;
  created_at: string;
  updated_at: string;
};

export type GmailOauthStateRow = {
  state: string;
  created_by: string;
  expires_at: string;
  created_at: string;
};

type TableDef<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      app_users: TableDef<
        AppUserRow,
        Partial<AppUserRow> &
          Pick<AppUserRow, "id" | "email" | "display_name" | "role">
      >;
      user_invitations: TableDef<
        UserInvitationRow,
        Partial<UserInvitationRow> &
          Pick<
            UserInvitationRow,
            "email" | "normalized_email" | "display_name" | "role"
          >
      >;
      jobs: TableDef<JobRow>;
      job_items: TableDef<Record<string, unknown>>;
      audit_logs: TableDef<AuditLogRow>;
      write_operations: TableDef<WriteOperationRow>;
      sync_errors: TableDef<SyncErrorRow>;
      webhook_events: TableDef<Record<string, unknown>>;
      import_jobs: TableDef<ImportJobRow>;
      import_rows: TableDef<ImportRowRow>;
      saved_searches: TableDef<Record<string, unknown>>;
      recent_views: TableDef<Record<string, unknown>>;
      system_settings: TableDef<SystemSettingRow>;
      notion_rate_limiter: TableDef<NotionRateLimiterRow>;
      customer_index: TableDef<CustomerIndexRow>;
      customer_relations: TableDef<{
        from_page_id: string;
        to_page_id: string;
      }>;
      contact_index: TableDef<ContactIndexRow>;
      deal_index: TableDef<DealIndexRow>;
      activity_index: TableDef<ActivityIndexRow>;
      contract_index: TableDef<ContractIndexRow>;
      complaint_index: TableDef<ComplaintIndexRow>;
      action_index: TableDef<ActionIndexRow>;
      masters_cache: TableDef<MastersCacheRow>;
      inquiries: TableDef<InquiryRow>;
      gmail_oauth_states: TableDef<GmailOauthStateRow>;
      inquiry_draft_requests: TableDef<{
        id: string;
        inquiry_id: string;
        draft_request_id: string;
        from_alias: string | null;
        created_by: string | null;
        created_at: string;
      }>;
      apps_script_request_nonces: TableDef<{
        nonce: string;
        purpose: string;
        created_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      accept_invitation_and_provision: {
        Args: {
          p_user_id: string;
          p_email: string;
        };
        Returns: AppUserRow;
      };
      current_app_role: {
        Args: Record<string, never>;
        Returns: AppRole | null;
      };
      claim_next_job: {
        Args: {
          p_worker_id: string;
          p_lease_seconds?: number;
        };
        Returns: JobRow[];
      };
      heartbeat_job: {
        Args: {
          p_job_id: string;
          p_worker_id: string;
          p_lease_seconds?: number;
        };
        Returns: boolean;
      };
      complete_job: {
        Args: {
          p_job_id: string;
          p_worker_id: string;
          p_result?: Record<string, unknown> | null;
        };
        Returns: boolean;
      };
      fail_job: {
        Args: {
          p_job_id: string;
          p_worker_id: string;
          p_error_message?: string | null;
          p_backoff_seconds?: number;
        };
        Returns: boolean;
      };
      ingest_webhook_event: {
        Args: {
          p_event_id: string;
          p_event_type: string;
          p_payload: Record<string, unknown>;
        };
        Returns: string;
      };
      store_notion_webhook_verification_token: {
        Args: {
          p_token: string;
        };
        Returns: Record<string, unknown>;
      };
      read_notion_webhook_verification_token: {
        Args: Record<string, never>;
        Returns: string;
      };
      mark_notion_webhook_verified: {
        Args: Record<string, never>;
        Returns: Record<string, unknown>;
      };
      store_gmail_oauth_refresh_token: {
        Args: { p_token: string };
        Returns: Record<string, unknown>;
      };
      read_gmail_oauth_refresh_token: {
        Args: Record<string, never>;
        Returns: string;
      };
      clear_gmail_oauth_refresh_token: {
        Args: Record<string, never>;
        Returns: Record<string, unknown>;
      };
      ingest_gmail_pubsub_event: {
        Args: {
          p_event_id: string;
          p_email_address: string | null;
          p_history_id: string;
          p_payload: Record<string, unknown>;
        };
        Returns: string;
      };
      reserve_notion_slot: {
        Args: {
          p_priority?: string;
        };
        Returns: string;
      };
      report_notion_rate_limited: {
        Args: {
          p_retry_after_seconds: number;
        };
        Returns: undefined;
      };
      get_notion_rate_limiter_state: {
        Args: Record<string, never>;
        Returns: NotionRateLimiterRow[];
      };
    };
    Enums: {
      app_role: AppRole;
      provisioning_status: ProvisioningStatus;
      invitation_status: InvitationStatus;
      sync_status: SyncStatus;
      job_status: JobStatus;
      write_op_status: WriteOpStatus;
      import_row_status: ImportRowStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
