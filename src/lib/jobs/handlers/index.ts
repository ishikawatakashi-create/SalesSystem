import type { JobHandler, JobKind } from "@/lib/jobs/types";
import { recalculateExpectedAmountHandler } from "@/lib/jobs/handlers/recalculate-expected-amount";
import { recalculateLatestActivityHandler } from "@/lib/jobs/handlers/recalculate-latest-activity";
import {
  recalculateCustomerNextActionHandler,
  recalculateDealNextActionHandler,
} from "@/lib/jobs/handlers/recalculate-next-action";
import { reconciliationHandler } from "@/lib/jobs/handlers/reconciliation";
import { syncRepairHandler } from "@/lib/jobs/handlers/sync-repair";
import { webhookSyncHandler } from "@/lib/jobs/handlers/webhook-sync";

/**
 * kindごとのハンドラー登録。
 * Phase 1基盤段階ではnoopのみ。Notion接続後に各kindを実装する。
 */
const handlers = new Map<string, JobHandler>();

export function registerJobHandler(kind: JobKind | string, handler: JobHandler): void {
  handlers.set(kind, handler);
}

export function getJobHandler(kind: string): JobHandler | undefined {
  return handlers.get(kind);
}

/** 基盤検証・滞留検知用のnoopハンドラー */
export const noopJobHandler: JobHandler = async () => ({ status: "succeeded" });

registerJobHandler("storage_cleanup", noopJobHandler);
registerJobHandler("dependency_reindex", noopJobHandler);
registerJobHandler("webhook_sync", webhookSyncHandler);
registerJobHandler("reconciliation", reconciliationHandler);
registerJobHandler("sync_repair", syncRepairHandler);
registerJobHandler(
  "customer.recalculate_expected_amount",
  recalculateExpectedAmountHandler,
);
registerJobHandler(
  "customer.recalculate_latest_activity",
  recalculateLatestActivityHandler,
);
registerJobHandler(
  "customer.recalculate_next_action",
  recalculateCustomerNextActionHandler,
);
registerJobHandler(
  "deal.recalculate_next_action",
  recalculateDealNextActionHandler,
);
