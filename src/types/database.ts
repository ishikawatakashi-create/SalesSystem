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
      import_jobs: TableDef<Record<string, unknown>>;
      import_rows: TableDef<Record<string, unknown>>;
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
      deal_index: TableDef<Record<string, unknown>>;
      activity_index: TableDef<Record<string, unknown>>;
      contract_index: TableDef<Record<string, unknown>>;
      complaint_index: TableDef<Record<string, unknown>>;
      action_index: TableDef<Record<string, unknown>>;
      masters_cache: TableDef<MastersCacheRow>;
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
