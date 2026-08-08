export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";

export type JobKind =
  | "csv_import"
  | "webhook_sync"
  | "reconciliation"
  | "sync_repair"
  | "bulk_activity"
  | "export_full"
  | "dependency_reindex"
  | "user_provisioning"
  | "storage_cleanup"
  | "customer.recalculate_expected_amount"
  | "customer.recalculate_latest_activity"
  | "customer.recalculate_next_action"
  | "customer.backfill_default_relationship"
  | "deal.recalculate_next_action"
  | "prospect_csv_import"
  | "prospect_bulk_assign";

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

export type JobHandlerResult =
  | { status: "succeeded"; result?: Record<string, unknown> }
  | { status: "retry"; errorMessage: string; backoffSeconds?: number }
  | { status: "failed"; errorMessage: string };

export type JobHandler = (job: JobRow, ctx: JobHandlerContext) => Promise<JobHandlerResult>;

export type JobHandlerContext = {
  workerId: string;
  /** falseなら後続の外部作用を即時中断すること */
  heartbeat: () => Promise<boolean>;
};
