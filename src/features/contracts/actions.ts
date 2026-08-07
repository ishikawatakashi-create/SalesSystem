"use server";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { getContractDetail } from "@/lib/contracts/read-detail";
import { prepareContractWrite } from "@/lib/contracts/write-schema";
import { isContractSyncError } from "@/lib/sync/errors";
import {
  contractCreate,
  contractUpdate,
} from "@/lib/sync/contract-write-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ContractActionResult =
  | { ok: true; notionPageId: string; warning?: string }
  | { ok: false; message: string; reason?: string };

function toFailure(error: unknown): ContractActionResult {
  if (error instanceof AuthError) {
    return { ok: false, message: error.message, reason: error.code };
  }
  if (isContractSyncError(error)) {
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

/** 契約新規作成 */
export async function createContractAction(input: {
  requestId: string;
  data: unknown;
}): Promise<ContractActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "contract.edit");
    if (!UUID_RE.test(input.requestId)) {
      return { ok: false, message: "リクエストIDが不正です", reason: "schema" };
    }

    const admin = createAdminClient();
    const write = await prepareContractWrite({ data: input.data, db: admin });

    const result = await contractCreate({
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

/** 契約更新。楽観ロック競合は上書きしない */
export async function updateContractAction(input: {
  requestId: string;
  notionPageId: string;
  externalId: string;
  expectedLastEditedTime: string;
  data: unknown;
}): Promise<ContractActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "contract.edit");
    if (
      !UUID_RE.test(input.requestId) ||
      !UUID_RE.test(input.notionPageId) ||
      !UUID_RE.test(input.externalId)
    ) {
      return { ok: false, message: "リクエストが不正です", reason: "schema" };
    }

    const current = await getContractDetail({
      notionPageId: input.notionPageId,
    });

    const admin = createAdminClient();
    const write = await prepareContractWrite({
      data: input.data,
      db: admin,
      context: {
        current: {
          customerPageId: current.customerPageId,
          dealPageId: current.dealPageId,
          contractTypePageId: current.contractTypePageId,
          tradeTypePageId: current.tradeTypePageId,
          paymentStatusPageId: current.paymentStatusPageId,
          statusPageId: current.statusPageId,
          staffPageIds: current.staffPageIds,
        },
      },
    });

    const result = await contractUpdate({
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
