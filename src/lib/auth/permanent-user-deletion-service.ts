import "server-only";

import { z } from "zod";

import { deleteRegisteredInvitedAuthUser } from "@/lib/auth/admin-api";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/types/database";

export type PermanentDeleteReason =
  | "re-register"
  | "mistaken_invitation"
  | "test";

export type PermanentDeleteEligibility = {
  eligible: boolean;
  reasonCode: string;
};

export type PermanentUserDeletionActor = {
  id: string;
  role: AppRole;
  is_active: boolean;
};

export type PermanentUserDeletionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

type PreparedDeletion = {
  state?: unknown;
  auth_user_id?: unknown;
  normalized_email?: unknown;
  invitation_id?: unknown;
};

const deletionSchema = z.object({
  targetUserId: z.uuid(),
  reason: z.enum(["re-register", "mistaken_invitation", "test"]),
});

function isActiveAdmin(actor: PermanentUserDeletionActor): boolean {
  return actor.is_active && actor.role === "admin";
}

export function permanentDeletionErrorMessage(message: string): string {
  if (message.includes("self_delete")) {
    return "自分自身を完全削除することはできません。";
  }
  if (message.includes("last_admin")) {
    return "最後の有効な管理者は完全削除できません。";
  }
  if (message.includes("storage_owned")) {
    return "このユーザーに紐づくファイルがあるため削除できません。";
  }
  if (
    message.includes("business_references") ||
    message.includes("notion_staff_profile_exists")
  ) {
    return "このユーザーは業務履歴があるため削除できません。利用停止を使用してください。";
  }
  if (message.includes("not_invited_origin")) {
    return "完全削除は誤招待・テスト登録・登録し直しが必要な招待由来ユーザーだけに使用できます。";
  }
  if (message.includes("admin_required")) {
    return "管理者権限が必要です";
  }
  if (message.includes("user_not_found")) {
    return "ユーザーが見つかりません。";
  }
  return "Auth・ユーザー・招待の対応を安全に確認できないため、完全削除を停止しました。";
}

/** 管理画面表示用。招待由来ユーザーだけをDBの同一判定ロジックで評価する。 */
export async function listPermanentDeleteEligibility(input: {
  actor: PermanentUserDeletionActor;
}): Promise<Map<string, PermanentDeleteEligibility>> {
  if (!isActiveAdmin(input.actor)) return new Map();
  const admin = createAdminClient();
  const result = await admin.rpc("list_user_permanent_delete_eligibility", {
    p_actor_id: input.actor.id,
  });
  if (result.error) {
    console.error("完全削除可否の確認に失敗しました", result.error);
    return new Map();
  }

  const map = new Map<string, PermanentDeleteEligibility>();
  for (const row of result.data ?? []) {
    map.set(String(row.target_user_id), {
      eligible: Boolean(row.eligible),
      reasonCode: String(row.reason_code ?? "state_ambiguous"),
    });
  }
  return map;
}

/**
 * DB profile削除 -> Auth hard delete -> DB finalizeを実行する。
 * Auth失敗時はDB snapshotからprofileと招待状態を復元し、片残りを防ぐ。
 */
export async function permanentlyDeleteInvitedUser(input: {
  actor: PermanentUserDeletionActor;
  targetUserId: string;
  reason: PermanentDeleteReason;
}): Promise<PermanentUserDeletionResult> {
  if (!isActiveAdmin(input.actor)) {
    return { ok: false, message: "管理者権限が必要です" };
  }
  const parsed = deletionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "入力内容を確認してください。" };
  }

  const admin = createAdminClient();
  const prepared = await admin.rpc("prepare_user_permanent_deletion", {
    p_actor_id: input.actor.id,
    p_target_user_id: parsed.data.targetUserId,
    p_reason: parsed.data.reason,
  });
  if (prepared.error) {
    return {
      ok: false,
      message: permanentDeletionErrorMessage(String(prepared.error.message ?? "")),
    };
  }

  const data = (prepared.data ?? {}) as PreparedDeletion;
  if (data.state === "already_deleted") {
    return { ok: true, message: "このユーザーは既に完全削除されています。" };
  }
  if (
    data.state !== "ready_for_auth_cleanup" ||
    typeof data.auth_user_id !== "string" ||
    typeof data.normalized_email !== "string" ||
    typeof data.invitation_id !== "string"
  ) {
    return {
      ok: false,
      message: "削除状態を安全に確認できないため、完全削除を停止しました。",
    };
  }

  const authDeleted = await deleteRegisteredInvitedAuthUser({
    userId: data.auth_user_id,
    invitationId: data.invitation_id,
    normalizedEmail: data.normalized_email,
  });

  if (!authDeleted.ok) {
    const restored = await admin.rpc("restore_user_after_permanent_delete_failure", {
      p_actor_id: input.actor.id,
      p_target_user_id: data.auth_user_id,
      p_detail: authDeleted.code,
    });
    if (restored.error) {
      await admin.rpc("record_permanent_delete_restore_failure", {
        p_actor_id: input.actor.id,
        p_target_user_id: data.auth_user_id,
        p_detail: String(restored.error.message ?? authDeleted.code),
      });
      return {
        ok: false,
        message:
          "Auth削除とユーザー情報の復元を完了できませんでした。再実行せず、管理者が削除操作ログを確認してください。",
      };
    }
    return {
      ok: false,
      message:
        authDeleted.code === "mapping_mismatch"
          ? "Authとの対応が一致しないため完全削除を停止し、ユーザー情報を復元しました。"
          : "Auth削除に失敗したため完全削除を停止し、ユーザー情報を復元しました。",
    };
  }

  const finalized = await admin.rpc("finalize_user_permanent_deletion", {
    p_actor_id: input.actor.id,
    p_target_user_id: data.auth_user_id,
    p_auth_outcome: authDeleted.outcome,
  });
  if (finalized.error) {
    return {
      ok: false,
      message:
        "Authは削除されましたが、完了状態を記録できませんでした。同じ操作を再実行してください。",
    };
  }

  return {
    ok: true,
    message: "ユーザー情報とログインアカウントを完全に削除しました。",
  };
}
