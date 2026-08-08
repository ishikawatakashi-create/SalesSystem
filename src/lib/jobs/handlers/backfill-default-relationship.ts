import "server-only";

import {
  processBackfillDefaultRelationshipChunk,
  type BackfillDefaultRelationshipPayload,
} from "@/lib/customers/backfill-default-relationship";
import type { JobHandler } from "@/lib/jobs/types";

/**
 * 関係性未設定顧客へデフォルト「顧客」を付与するチャンクジョブ。
 * 続きは同 kind を enqueue（attempts を消費しない）。
 */
export const backfillDefaultRelationshipHandler: JobHandler = async (
  job,
  ctx,
) => {
  const alive = await ctx.heartbeat();
  if (!alive) {
    return {
      status: "retry",
      errorMessage: "lease_lost",
      backoffSeconds: 30,
    };
  }

  const payload = (job.payload ?? {}) as BackfillDefaultRelationshipPayload;

  try {
    const result = await processBackfillDefaultRelationshipChunk({
      payload: {
        ...payload,
        chainId: payload.chainId ?? job.id,
      },
      enqueueNext: true,
      createdBy: job.created_by,
      heartbeat: ctx.heartbeat,
    });

    return {
      status: "succeeded",
      result: {
        done: result.done,
        chunkSize: result.chunkSize,
        processed: result.processed,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
        cursor: result.cursor,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "backfill_default_relationship_failed";
    if (message === "lease_lost_during_chunk") {
      return {
        status: "retry",
        errorMessage: message,
        backoffSeconds: 30,
      };
    }
    // Notion 一時障害は retry、マスタ欠落等は failed
    if (/masters_cache|がありません|未設定/.test(message)) {
      return { status: "failed", errorMessage: message };
    }
    return {
      status: "retry",
      errorMessage: message,
      backoffSeconds: 120,
    };
  }
};
