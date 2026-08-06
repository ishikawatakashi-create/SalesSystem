"use server";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { getContactDetail } from "@/lib/contacts/read-detail";
import { prepareContactWrite } from "@/lib/contacts/write-schema";
import { isContactSyncError } from "@/lib/sync/errors";
import { contactCreate, contactUpdate } from "@/lib/sync/contact-write-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ContactActionResult =
  | { ok: true; notionPageId: string; warning?: string }
  | { ok: false; message: string; reason?: string };

function toFailure(error: unknown): ContactActionResult {
  if (error instanceof AuthError) {
    return { ok: false, message: error.message, reason: error.code };
  }
  if (isContactSyncError(error)) {
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

/** 先方担当者新規作成。検証はwrite_operations作成・Notion呼出より前 */
export async function createContactAction(input: {
  requestId: string;
  data: unknown;
}): Promise<ContactActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "contact.edit");
    if (!UUID_RE.test(input.requestId)) {
      return { ok: false, message: "リクエストIDが不正です", reason: "schema" };
    }

    const admin = createAdminClient();
    const write = await prepareContactWrite({ data: input.data, db: admin });

    const result = await contactCreate({
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

/** 先方担当者更新(無効化含む)。楽観ロック競合は上書きしない */
export async function updateContactAction(input: {
  requestId: string;
  notionPageId: string;
  externalId: string;
  expectedLastEditedTime: string;
  data: unknown;
}): Promise<ContactActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "contact.edit");
    if (
      !UUID_RE.test(input.requestId) ||
      !UUID_RE.test(input.notionPageId) ||
      !UUID_RE.test(input.externalId)
    ) {
      return { ok: false, message: "リクエストが不正です", reason: "schema" };
    }

    // 変更前relation(維持されている無効値の許可判定)はNotion正本から取得する
    const current = await getContactDetail({
      notionPageId: input.notionPageId,
    });

    const admin = createAdminClient();
    const write = await prepareContactWrite({
      data: input.data,
      db: admin,
      context: {
        current: {
          customerPageId: current.customerPageId,
          contactTypePageId: current.contactTypePageId,
        },
      },
    });

    const result = await contactUpdate({
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
