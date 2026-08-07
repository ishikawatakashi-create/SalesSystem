"use server";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { getActionDetail } from "@/lib/actions/read-detail";
import { prepareActionWrite } from "@/lib/actions/write-schema";
import { isActionSyncError } from "@/lib/sync/errors";
import {
  actionCreate,
  actionUpdate,
} from "@/lib/sync/action-write-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveActionStatusPageIdBySemantic } from "@/features/actions/options";
import { todayDateTokyo } from "@/lib/normalize/date-tokyo";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActionActionResult =
  | { ok: true; notionPageId: string; warning?: string }
  | { ok: false; message: string; reason?: string };

function toFailure(error: unknown): ActionActionResult {
  if (error instanceof AuthError) {
    return { ok: false, message: error.message, reason: error.code };
  }
  if (isActionSyncError(error)) {
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

/** 次回アクション新規作成 */
export async function createActionAction(input: {
  requestId: string;
  data: unknown;
}): Promise<ActionActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "action.edit");
    if (!UUID_RE.test(input.requestId)) {
      return { ok: false, message: "リクエストIDが不正です", reason: "schema" };
    }

    const admin = createAdminClient();
    const write = await prepareActionWrite({ data: input.data, db: admin });

    const result = await actionCreate({
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

/** 次回アクション更新。楽観ロック競合は上書きしない */
export async function updateActionAction(input: {
  requestId: string;
  notionPageId: string;
  externalId: string;
  expectedLastEditedTime: string;
  data: unknown;
}): Promise<ActionActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "action.edit");
    if (
      !UUID_RE.test(input.requestId) ||
      !UUID_RE.test(input.notionPageId) ||
      !UUID_RE.test(input.externalId)
    ) {
      return { ok: false, message: "リクエストが不正です", reason: "schema" };
    }

    const current = await getActionDetail({
      notionPageId: input.notionPageId,
    });

    const admin = createAdminClient();
    const write = await prepareActionWrite({
      data: input.data,
      db: admin,
      context: {
        current: {
          customerPageId: current.customerPageId,
          dealPageId: current.dealPageId,
          activityPageId: current.activityPageId,
          staffPageId: current.staffPageId,
          statusPageId: current.statusPageId,
          priorityPageId: current.priorityPageId,
        },
      },
    });

    const result = await actionUpdate({
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

/**
 * 完了ラッパー。done 状態へ更新し楽観ロックを適用。
 * requestId は呼び出し側で1回生成したものを渡す。
 */
export async function completeActionAction(input: {
  requestId: string;
  notionPageId: string;
  externalId: string;
  expectedLastEditedTime: string;
}): Promise<ActionActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "action.edit");
    if (
      !UUID_RE.test(input.requestId) ||
      !UUID_RE.test(input.notionPageId) ||
      !UUID_RE.test(input.externalId)
    ) {
      return { ok: false, message: "リクエストが不正です", reason: "schema" };
    }

    const current = await getActionDetail({
      notionPageId: input.notionPageId,
      skipCache: true,
    });

    const doneStatusId = await resolveActionStatusPageIdBySemantic("done");
    if (!doneStatusId) {
      return {
        ok: false,
        message: "完了状態のマスタが見つかりません",
        reason: "validation",
      };
    }

    if (!current.customerPageId) {
      return {
        ok: false,
        message: "顧客が設定されていないため完了できません",
        reason: "validation",
      };
    }
    if (!current.dueDate) {
      return {
        ok: false,
        message: "期限が設定されていないため完了できません",
        reason: "validation",
      };
    }

    const admin = createAdminClient();
    const write = await prepareActionWrite({
      data: {
        title: current.title,
        customerPageId: current.customerPageId,
        dealPageId: current.dealPageId,
        activityPageId: current.activityPageId,
        staffPageId: current.staffPageId,
        dueDate: current.dueDate,
        statusPageId: doneStatusId,
        priorityPageId: current.priorityPageId,
        completedAt: current.completedAt ?? todayDateTokyo(),
      },
      db: admin,
      context: {
        current: {
          customerPageId: current.customerPageId,
          dealPageId: current.dealPageId,
          activityPageId: current.activityPageId,
          staffPageId: current.staffPageId,
          statusPageId: current.statusPageId,
          priorityPageId: current.priorityPageId,
        },
      },
    });

    const result = await actionUpdate({
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
