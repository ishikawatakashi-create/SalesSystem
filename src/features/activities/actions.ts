"use server";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { getActivityDetail } from "@/lib/activities/read-detail";
import { prepareActivityWrite } from "@/lib/activities/write-schema";
import { bulkCreateActivities } from "@/lib/activities/bulk-create";
import { prepareActionWrite } from "@/lib/actions/write-schema";
import {
  isActivitySyncError,
  isActionSyncError,
} from "@/lib/sync/errors";
import {
  activityCreate,
  activityUpdate,
} from "@/lib/sync/activity-write-pipeline";
import { actionCreate } from "@/lib/sync/action-write-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveActionStatusPageIdBySemantic } from "@/features/actions/options";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActivityActionResult =
  | { ok: true; notionPageId: string; warning?: string }
  | { ok: false; message: string; reason?: string };

export type ActivityWithNextActionResult =
  | {
      ok: true;
      activityPageId: string;
      actionPageId: string | null;
      partialFailure?: boolean;
      warning?: string;
      correlationId: string;
      /** アクションのみ再試行可能 */
      canRetryAction: boolean;
      actionRequestId?: string;
    }
  | {
      ok: false;
      message: string;
      reason?: string;
      activityPageId?: string | null;
      correlationId?: string;
      canRetryAction?: boolean;
      actionRequestId?: string;
    };

export type ActivityBulkActionResult =
  | {
      ok: true;
      batchRequestId: string;
      rows: {
        rowId: string;
        ok: boolean;
        notionPageId: string | null;
        message?: string;
      }[];
    }
  | { ok: false; message: string; reason?: string };

function toFailure(error: unknown): ActivityActionResult {
  if (error instanceof AuthError) {
    return { ok: false, message: error.message, reason: error.code };
  }
  if (isActivitySyncError(error)) {
    const reason =
      (error.detail?.reason as string | undefined) ?? error.code;
    switch (error.code) {
      case "validation":
      case "conflict":
      case "in_trash":
      case "not_found":
        return { ok: false, message: error.message, reason };
      case "input_hash_mismatch":
        return {
          ok: false,
          message: "保存に失敗しました。ページを再読込してやり直してください",
          reason: error.code,
        };
      default:
        return {
          ok: false,
          message: "保存に失敗しました。時間をおいて再度お試しください",
          reason: error.code,
        };
    }
  }
  return {
    ok: false,
    message: "保存に失敗しました。時間をおいて再度お試しください",
    reason: "unknown",
  };
}

function safeActionMessage(error: unknown): string {
  if (isActionSyncError(error)) {
    if (
      error.code === "validation" ||
      error.code === "conflict" ||
      error.code === "not_found"
    ) {
      return error.message;
    }
  }
  return "次回アクションの登録に失敗しました。対応履歴は保存済みです";
}

/** 対応履歴新規作成 */
export async function createActivityAction(input: {
  requestId: string;
  data: unknown;
}): Promise<ActivityActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "activity.edit");
    if (!UUID_RE.test(input.requestId)) {
      return { ok: false, message: "リクエストIDが不正です", reason: "schema" };
    }

    const admin = createAdminClient();
    const write = await prepareActivityWrite({ data: input.data, db: admin });

    const result = await activityCreate({
      requestId: input.requestId,
      actorId: user.id,
      actorName: user.display_name,
      input: write,
    });
    if (!result.notionPageId) {
      return {
        ok: false,
        message: "保存に失敗しました。時間をおいて再度お試しください",
        reason: "no_page",
      };
    }
    return {
      ok: true,
      notionPageId: result.notionPageId,
      warning: result.warning,
    };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * 対応履歴作成 + 続けて次回アクション作成。
 * write_ops は別 request_id。correlationId で関連付け。
 * 履歴成功・アクション失敗時は部分成功を返し、アクションのみ再試行可。
 */
export async function createActivityWithNextActionAction(input: {
  correlationId: string;
  activityRequestId: string;
  actionRequestId: string;
  activityData: unknown;
  nextAction: {
    title: string;
    dueDate: string;
    staffPageId?: string | null;
    priorityPageId?: string | null;
  };
}): Promise<ActivityWithNextActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "activity.edit");
    requirePermission(user, "action.edit");

    if (
      !UUID_RE.test(input.correlationId) ||
      !UUID_RE.test(input.activityRequestId) ||
      !UUID_RE.test(input.actionRequestId)
    ) {
      return { ok: false, message: "リクエストIDが不正です", reason: "schema" };
    }

    const admin = createAdminClient();
    const activityWrite = await prepareActivityWrite({
      data: input.activityData,
      db: admin,
    });

    // 入力記録スナップショットにも残す
    const activityWithSnapshot = {
      ...activityWrite,
      nextActionNote: activityWrite.nextActionNote ?? input.nextAction.title,
      nextActionDate:
        activityWrite.nextActionDate ?? input.nextAction.dueDate,
    };

    const activityResult = await activityCreate({
      requestId: input.activityRequestId,
      actorId: user.id,
      actorName: user.display_name,
      input: activityWithSnapshot,
    });

    if (!activityResult.notionPageId) {
      return {
        ok: false,
        message: "保存に失敗しました。時間をおいて再度お試しください",
        reason: "no_page",
        correlationId: input.correlationId,
      };
    }

    const openStatusId = await resolveActionStatusPageIdBySemantic("open");
    if (!openStatusId) {
      return {
        ok: true,
        activityPageId: activityResult.notionPageId,
        actionPageId: null,
        partialFailure: true,
        warning:
          "対応履歴は保存しましたが、アクション状態マスタが見つからないため次回アクションを登録できませんでした",
        correlationId: input.correlationId,
        canRetryAction: true,
        actionRequestId: input.actionRequestId,
      };
    }

    try {
      const actionWrite = await prepareActionWrite({
        data: {
          title: input.nextAction.title,
          customerPageId: activityWrite.customerPageId,
          dealPageId: activityWrite.dealPageId,
          activityPageId: activityResult.notionPageId,
          staffPageId: input.nextAction.staffPageId ?? null,
          dueDate: input.nextAction.dueDate,
          statusPageId: openStatusId,
          priorityPageId: input.nextAction.priorityPageId ?? null,
          completedAt: null,
        },
        db: admin,
      });

      const actionResult = await actionCreate({
        requestId: input.actionRequestId,
        actorId: user.id,
        actorName: user.display_name,
        input: actionWrite,
      });

      if (!actionResult.notionPageId) {
        return {
          ok: true,
          activityPageId: activityResult.notionPageId,
          actionPageId: null,
          partialFailure: true,
          warning:
            "対応履歴は保存しましたが、次回アクションの登録に失敗しました。アクションのみ再試行できます",
          correlationId: input.correlationId,
          canRetryAction: true,
          actionRequestId: input.actionRequestId,
        };
      }

      return {
        ok: true,
        activityPageId: activityResult.notionPageId,
        actionPageId: actionResult.notionPageId,
        warning: activityResult.warning ?? actionResult.warning,
        correlationId: input.correlationId,
        canRetryAction: false,
      };
    } catch (actionError) {
      return {
        ok: true,
        activityPageId: activityResult.notionPageId,
        actionPageId: null,
        partialFailure: true,
        warning: safeActionMessage(actionError),
        correlationId: input.correlationId,
        canRetryAction: true,
        actionRequestId: input.actionRequestId,
      };
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, message: error.message, reason: error.code };
    }
    if (isActivitySyncError(error)) {
      const reason =
        (error.detail?.reason as string | undefined) ?? error.code;
      return { ok: false, message: error.message, reason };
    }
    return {
      ok: false,
      message: "保存に失敗しました。時間をおいて再度お試しください",
      reason: "unknown",
    };
  }
}

/** 部分成功後の次回アクションのみ再試行 */
export async function retryNextActionAfterActivityAction(input: {
  correlationId: string;
  actionRequestId: string;
  activityPageId: string;
  customerPageId: string;
  dealPageId?: string | null;
  nextAction: {
    title: string;
    dueDate: string;
    staffPageId?: string | null;
    priorityPageId?: string | null;
  };
}): Promise<ActivityWithNextActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "action.edit");

    if (
      !UUID_RE.test(input.correlationId) ||
      !UUID_RE.test(input.actionRequestId) ||
      !UUID_RE.test(input.activityPageId) ||
      !UUID_RE.test(input.customerPageId)
    ) {
      return { ok: false, message: "リクエストが不正です", reason: "schema" };
    }

    const admin = createAdminClient();
    const openStatusId = await resolveActionStatusPageIdBySemantic("open");
    if (!openStatusId) {
      return {
        ok: false,
        message: "アクション状態マスタが見つかりません",
        reason: "validation",
        activityPageId: input.activityPageId,
        correlationId: input.correlationId,
        canRetryAction: true,
        actionRequestId: input.actionRequestId,
      };
    }

    const actionWrite = await prepareActionWrite({
      data: {
        title: input.nextAction.title,
        customerPageId: input.customerPageId,
        dealPageId: input.dealPageId ?? null,
        activityPageId: input.activityPageId,
        staffPageId: input.nextAction.staffPageId ?? null,
        dueDate: input.nextAction.dueDate,
        statusPageId: openStatusId,
        priorityPageId: input.nextAction.priorityPageId ?? null,
        completedAt: null,
      },
      db: admin,
    });

    const actionResult = await actionCreate({
      requestId: input.actionRequestId,
      actorId: user.id,
      actorName: user.display_name,
      input: actionWrite,
    });

    if (!actionResult.notionPageId) {
      return {
        ok: false,
        message: "次回アクションの登録に失敗しました",
        reason: "no_page",
        activityPageId: input.activityPageId,
        correlationId: input.correlationId,
        canRetryAction: true,
        actionRequestId: input.actionRequestId,
      };
    }

    return {
      ok: true,
      activityPageId: input.activityPageId,
      actionPageId: actionResult.notionPageId,
      correlationId: input.correlationId,
      canRetryAction: false,
      warning: actionResult.warning,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, message: error.message, reason: error.code };
    }
    if (isActionSyncError(error)) {
      return {
        ok: false,
        message: safeActionMessage(error),
        reason: error.code,
        activityPageId: input.activityPageId,
        correlationId: input.correlationId,
        canRetryAction: true,
        actionRequestId: input.actionRequestId,
      };
    }
    return {
      ok: false,
      message: "次回アクションの登録に失敗しました",
      reason: "unknown",
      activityPageId: input.activityPageId,
      correlationId: input.correlationId,
      canRetryAction: true,
      actionRequestId: input.actionRequestId,
    };
  }
}

/** 対応履歴更新。楽観ロック競合は上書きしない */
export async function updateActivityAction(input: {
  requestId: string;
  notionPageId: string;
  externalId: string;
  expectedLastEditedTime: string;
  data: unknown;
}): Promise<ActivityActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "activity.edit");
    if (
      !UUID_RE.test(input.requestId) ||
      !UUID_RE.test(input.notionPageId) ||
      !UUID_RE.test(input.externalId)
    ) {
      return { ok: false, message: "リクエストが不正です", reason: "schema" };
    }

    const current = await getActivityDetail({
      notionPageId: input.notionPageId,
    });

    const admin = createAdminClient();
    const write = await prepareActivityWrite({
      data: input.data,
      db: admin,
      context: {
        current: {
          customerPageId: current.customerPageId,
          dealPageId: current.dealPageId,
          contactPageIds: current.contactPageIds,
          categoryPageIds: current.categoryPageIds,
        },
      },
    });

    const result = await activityUpdate({
      requestId: input.requestId,
      actorId: user.id,
      actorName: user.display_name,
      notionPageId: input.notionPageId,
      externalId: input.externalId,
      expectedLastEditedTime: input.expectedLastEditedTime,
      input: write,
    });
    return {
      ok: true,
      notionPageId: input.notionPageId,
      warning: result.warning,
    };
  } catch (error) {
    return toFailure(error);
  }
}

/** 対応履歴一括登録 */
export async function bulkCreateActivitiesAction(input: {
  batchRequestId: string;
  common: {
    title: string;
    activityAt: string;
    categoryPageIds: string[];
    summary?: string | null;
    body?: string;
    nextActionNote?: string | null;
    nextActionDate?: string | null;
  };
  customerPageIds: string[];
}): Promise<ActivityBulkActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "activity.bulk_create");

    if (!UUID_RE.test(input.batchRequestId)) {
      return { ok: false, message: "リクエストIDが不正です", reason: "schema" };
    }
    if (
      !Array.isArray(input.customerPageIds) ||
      input.customerPageIds.length === 0
    ) {
      return {
        ok: false,
        message: "顧客を1件以上選択してください",
        reason: "validation",
      };
    }
    if (input.customerPageIds.length > 100) {
      return {
        ok: false,
        message: "一度に登録できる顧客は100件までです",
        reason: "validation",
      };
    }
    for (const id of input.customerPageIds) {
      if (!UUID_RE.test(id)) {
        return {
          ok: false,
          message: "顧客の選択が不正です",
          reason: "validation",
        };
      }
    }

    const admin = createAdminClient();
    const rows = [];
    for (const customerPageId of input.customerPageIds) {
      const rowRequestId = crypto.randomUUID();
      const write = await prepareActivityWrite({
        data: {
          title: input.common.title,
          customerPageId,
          dealPageId: null,
          contactPageIds: [],
          activityAt: input.common.activityAt,
          categoryPageIds: input.common.categoryPageIds,
          summary: input.common.summary ?? null,
          nextActionNote: input.common.nextActionNote ?? null,
          nextActionDate: input.common.nextActionDate ?? null,
          body: input.common.body ?? "",
          batchId: input.batchRequestId,
        },
        db: admin,
      });
      rows.push({
        rowId: customerPageId,
        requestId: rowRequestId,
        input: write,
      });
    }

    const result = await bulkCreateActivities({
      batch: {
        batchRequestId: input.batchRequestId,
        rows,
      },
      actorId: user.id,
      actorName: user.display_name,
    });

    return {
      ok: true,
      batchRequestId: result.batchRequestId,
      rows: result.rows.map((r) => ({
        rowId: r.rowId,
        ok: r.status === "completed" || r.status === "notion_done",
        notionPageId: r.notionPageId,
        message: r.errorMessage,
      })),
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, message: error.message, reason: error.code };
    }
    if (isActivitySyncError(error)) {
      return { ok: false, message: error.message, reason: error.code };
    }
    return {
      ok: false,
      message: "一括登録に失敗しました。時間をおいて再度お試しください",
      reason: "unknown",
    };
  }
}
