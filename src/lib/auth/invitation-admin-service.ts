import "server-only";

import { deletePendingInvitedAuthUser } from "@/lib/auth/admin-api";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/types/database";

export type InvitationAdminActor = {
  id: string;
  role: AppRole;
  is_active: boolean;
};

export type InvitationAdminResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

type CancellationPreparation = {
  state?: unknown;
  auth_user_id?: unknown;
  normalized_email?: unknown;
};

function requireActiveAdmin(
  actor: InvitationAdminActor,
): InvitationAdminResult | null {
  if (actor.is_active && actor.role === "admin") return null;
  return { ok: false, message: "管理者権限が必要です" };
}

function cancellationErrorMessage(message: string): string {
  if (message.includes("invitation_accepted")) {
    return "この招待は既に受諾されています。登録済みユーザーには影響しないため、取消処理を停止しました。";
  }
  if (message.includes("invitation_profile_exists")) {
    return "正式なユーザープロフィールが存在するため、招待取消では削除できません。";
  }
  if (message.includes("invitation_auth_activated")) {
    return "ログインまたは認証済みのユーザーを検出したため、招待取消を停止しました。";
  }
  if (message.includes("invitation_business_data_exists")) {
    return "業務データから参照されているため、招待取消を停止しました。";
  }
  if (message.includes("invitation_expired")) {
    return "この招待は期限切れです。過去の招待から履歴を非表示にしてください。";
  }
  if (message.includes("invitation_not_found")) {
    return "指定された招待が見つかりません。";
  }
  if (message.includes("admin_required")) {
    return "管理者権限が必要です";
  }
  return "招待とAuthユーザーの状態を安全に確認できないため、処理を停止しました。";
}

async function recordCleanup(input: {
  actorId: string;
  invitationId: string;
  status: "deleted" | "not_found" | "skipped" | "failed";
  detail?: string;
}): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("record_invitation_auth_cleanup", {
    p_actor_id: input.actorId,
    p_invitation_id: input.invitationId,
    p_cleanup_status: input.status,
    p_detail: input.detail ?? null,
  });
  if (error) {
    console.error("招待Authユーザーのcleanup監査に失敗しました", error);
    return false;
  }
  return true;
}

/**
 * pending招待だけを取り消す。DBで状態をロック・検証してから、
 * server-only Auth Admin APIでも未確認状態を再検証して削除する。
 */
export async function cancelPendingInvitation(input: {
  actor: InvitationAdminActor;
  invitationId: string;
}): Promise<InvitationAdminResult> {
  const denied = requireActiveAdmin(input.actor);
  if (denied) return denied;

  const admin = createAdminClient();
  const prepared = await admin.rpc("prepare_invitation_cancellation", {
    p_actor_id: input.actor.id,
    p_invitation_id: input.invitationId,
  });
  if (prepared.error) {
    return {
      ok: false,
      message: cancellationErrorMessage(String(prepared.error.message ?? "")),
    };
  }

  const data = (prepared.data ?? {}) as CancellationPreparation;
  const state = String(data.state ?? "");
  if (state === "already_cancelled") {
    return { ok: true, message: "この招待は既に取り消されています。" };
  }
  if (state === "cancelled_no_auth_user") {
    return { ok: true, message: "招待を取り消しました。" };
  }
  if (
    state !== "ready_for_auth_cleanup" ||
    typeof data.auth_user_id !== "string" ||
    typeof data.normalized_email !== "string"
  ) {
    return {
      ok: false,
      message: "招待とAuthユーザーの状態を安全に確認できないため、処理を停止しました。",
    };
  }

  const deleted = await deletePendingInvitedAuthUser({
    userId: data.auth_user_id,
    invitationId: input.invitationId,
    normalizedEmail: data.normalized_email,
  });

  if (!deleted.ok) {
    const cleanupStatus = deleted.code === "auth_error" ? "failed" : "skipped";
    await recordCleanup({
      actorId: input.actor.id,
      invitationId: input.invitationId,
      status: cleanupStatus,
      detail: deleted.code,
    });
    if (deleted.code === "activated") {
      return {
        ok: false,
        message:
          "招待は無効化しましたが、ログインまたは認証済みの状態を検出したためAuthユーザーは削除していません。管理者が状態を確認してください。",
      };
    }
    if (deleted.code === "mapping_mismatch") {
      return {
        ok: false,
        message:
          "招待は無効化しましたが、Authユーザーとの対応が曖昧なため削除していません。管理者が状態を確認してください。",
      };
    }
    return {
      ok: false,
      message:
        "招待は無効化しましたが、Authユーザーの削除に失敗しました。時間をおいて再度お試しください。",
    };
  }

  const recorded = await recordCleanup({
    actorId: input.actor.id,
    invitationId: input.invitationId,
    status: deleted.outcome,
  });
  if (!recorded) {
    return {
      ok: false,
      message:
        "招待と未確認Authユーザーは無効化しましたが、監査状態の更新に失敗しました。管理者が確認してください。",
    };
  }

  return { ok: true, message: "招待を取り消しました。" };
}

/** 過去の招待表示だけをarchiveし、app_users/Auth userには触れない。 */
export async function archiveInvitationHistory(input: {
  actor: InvitationAdminActor;
  invitationId: string;
}): Promise<InvitationAdminResult> {
  const denied = requireActiveAdmin(input.actor);
  if (denied) return denied;

  const admin = createAdminClient();
  const archived = await admin.rpc("archive_invitation_history", {
    p_actor_id: input.actor.id,
    p_invitation_id: input.invitationId,
  });
  if (archived.error) {
    const message = String(archived.error.message ?? "");
    if (message.includes("invitation_still_pending")) {
      return { ok: false, message: "招待中の履歴は非表示にできません。" };
    }
    if (message.includes("admin_required")) {
      return { ok: false, message: "管理者権限が必要です" };
    }
    if (message.includes("invitation_not_found")) {
      return { ok: false, message: "指定された招待が見つかりません。" };
    }
    return {
      ok: false,
      message: "招待履歴を非表示にできませんでした。時間をおいて再度お試しください。",
    };
  }

  return {
    ok: true,
    message:
      archived.data === "already_archived"
        ? "この招待履歴は既に非表示です。"
        : "招待履歴を非表示にしました。",
  };
}
