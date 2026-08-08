"use server";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { getCustomerDetail } from "@/lib/customers/read-detail";
import { prepareCustomerWrite } from "@/lib/customers/write-schema";
import { isCustomerSyncError } from "@/lib/sync/errors";
import { customerCreate, customerUpdate } from "@/lib/sync/write-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CustomerActionResult =
  | { ok: true; notionPageId: string; warning?: string }
  | { ok: false; message: string; reason?: string };

function toFailure(error: unknown): CustomerActionResult {
  if (error instanceof AuthError) {
    return { ok: false, message: error.message, reason: error.code };
  }
  if (isCustomerSyncError(error)) {
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

/** 顧客新規作成。検証はwrite_operations作成・Notion呼出より前 */
export async function createCustomerAction(input: {
  requestId: string;
  data: unknown;
}): Promise<CustomerActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "customer.edit");
    if (!UUID_RE.test(input.requestId)) {
      return { ok: false, message: "リクエストIDが不正です", reason: "schema" };
    }

    const admin = createAdminClient();
    let write = await prepareCustomerWrite({ data: input.data, db: admin });
    // legacy/API互換: 関係性未指定なら customer を default
    if ((write.relationshipPageIds ?? []).length === 0) {
      const { findRelationshipMasterPageId } = await import(
        "@/lib/organizations/resolve-relationship-semantics"
      );
      const { DEFAULT_ORGANIZATION_RELATIONSHIP_SEMANTIC_KEY } = await import(
        "@/lib/organizations/relationship"
      );
      const defaultId = await findRelationshipMasterPageId(
        admin,
        DEFAULT_ORGANIZATION_RELATIONSHIP_SEMANTIC_KEY,
      );
      if (defaultId) {
        write = { ...write, relationshipPageIds: [defaultId] };
      }
    }

    const result = await customerCreate({
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

/** 顧客更新(アーカイブ含む)。楽観ロック競合は上書きしない */
export async function updateCustomerAction(input: {
  requestId: string;
  notionPageId: string;
  externalId: string;
  expectedLastEditedTime: string;
  data: unknown;
}): Promise<CustomerActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "customer.edit");
    if (
      !UUID_RE.test(input.requestId) ||
      !UUID_RE.test(input.notionPageId) ||
      !UUID_RE.test(input.externalId)
    ) {
      return { ok: false, message: "リクエストが不正です", reason: "schema" };
    }

    // 変更前relation(維持されている無効値の許可判定)はNotion正本から取得する
    const current = await getCustomerDetail({
      notionPageId: input.notionPageId,
    });

    const admin = createAdminClient();
    const write = await prepareCustomerWrite({
      data: input.data,
      db: admin,
      context: {
        selfPageId: input.notionPageId,
        current: {
          businessCategoryPageIds: current.businessCategoryPageIds,
          tagPageIds: current.tagPageIds,
          relationshipPageIds: current.relationshipPageIds ?? [],
          salesStatusPageId: current.salesStatusPageId,
          acquisitionRoutePageId: current.acquisitionRoutePageId,
          priorityPageId: current.priorityPageId,
          staffPageIds: current.staffPageIds,
          relatedAccountPageIds: current.relatedAccountPageIds,
        },
      },
    });

    const result = await customerUpdate({
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
