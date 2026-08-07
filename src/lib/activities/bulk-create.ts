import "server-only";

import type {
  ActivityBulkCreateInput,
  ActivityBulkCreateResult,
  ActivityBulkCreateRowResult,
  ActivityWriteInput,
} from "@/lib/activities/types";
import { uuidV5 } from "@/lib/notion/ids";
import {
  activityCreate,
  isActivitySyncError,
} from "@/lib/sync/activity-write-pipeline";

function mergeInput(
  common: Partial<ActivityWriteInput> | undefined,
  row: ActivityWriteInput,
): ActivityWriteInput {
  return {
    title: row.title ?? common?.title ?? "",
    customerPageId: row.customerPageId,
    dealPageId: row.dealPageId ?? common?.dealPageId ?? null,
    contactPageIds: row.contactPageIds ?? common?.contactPageIds ?? [],
    activityAt: row.activityAt ?? common?.activityAt ?? "",
    categoryPageIds: row.categoryPageIds ?? common?.categoryPageIds ?? [],
    summary: row.summary ?? common?.summary ?? null,
    nextActionNote: row.nextActionNote ?? common?.nextActionNote ?? null,
    nextActionDate: row.nextActionDate ?? common?.nextActionDate ?? null,
    body: row.body ?? common?.body ?? "",
    batchId: row.batchId ?? common?.batchId ?? null,
  };
}

/**
 * 対応履歴一括作成。行ごとに独立した requestId / Notion 作成。
 * クロスページの Notion トランザクションは持たない。
 * external_id は batch_id + 顧客ページID から決定的に生成。
 */
export async function bulkCreateActivities(input: {
  batch: ActivityBulkCreateInput;
  actorId: string;
  actorName: string;
}): Promise<ActivityBulkCreateResult> {
  const batchId = input.batch.batchRequestId;
  const rows: ActivityBulkCreateRowResult[] = [];

  for (const row of input.batch.rows) {
    const merged = mergeInput(input.batch.common, row.input);
    const write: ActivityWriteInput = {
      ...merged,
      batchId,
    };
    // 行ごとに別ページへするため rowId を含める(同一顧客でも衝突しない)
    const externalId = uuidV5(
      `activity:bulk:${batchId}:${row.rowId}:${write.customerPageId}`,
    );

    try {
      const result = await activityCreate({
        requestId: row.requestId,
        actorId: input.actorId,
        actorName: input.actorName,
        input: write,
        externalId,
      });
      rows.push({
        rowId: row.rowId,
        requestId: row.requestId,
        status: result.status,
        externalId: result.externalId,
        notionPageId: result.notionPageId,
        partialFailure: result.partialFailure,
        warning: result.warning,
      });
    } catch (error) {
      rows.push({
        rowId: row.rowId,
        requestId: row.requestId,
        status: "error",
        externalId,
        notionPageId: null,
        errorCode: isActivitySyncError(error) ? error.code : "notion_failed",
        errorMessage:
          error instanceof Error ? error.message : "一括登録に失敗しました",
      });
    }
  }

  return {
    batchRequestId: batchId,
    rows,
  };
}
