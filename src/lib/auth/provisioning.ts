import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { AppUserRow } from "@/types/database";

export type ProvisioningResult =
  | { ok: true; appUser: AppUserRow }
  | { ok: false; reason: "not_invited" | "inactive" | "error"; message: string };

/**
 * 認証成立後のプロビジョニング。auth/callbackから呼ばれる。
 *
 * Auth作成 → app_users作成 → Notion自社担当者ページ作成 は原子的でないため、
 * provisioning_statusで進行を記録する(docs/supabase-schema.md §2)。
 *
 * 認証スパイク中はAuth+app_users作成完了をprofile_createdとする。
 * Notion接続時にuser_provisioningジョブが自社担当者ページを作成し、
 * notion_staff_page_id保存と同時にcompletedへ遷移する。
 */
export async function ensureProvisioned(
  userId: string,
  email: string,
): Promise<ProvisioningResult> {
  const admin = createAdminClient();

  // 1) 既存のapp_usersを確認(再ログイン)
  const { data: existing, error: selectError } = await admin
    .from("app_users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (selectError) {
    return { ok: false, reason: "error", message: selectError.message };
  }
  if (existing) {
    if (!existing.is_active) {
      return {
        ok: false,
        reason: "inactive",
        message: "このアカウントは無効化されています。",
      };
    }
    // 旧暫定実装でapp_users作成後・招待更新前に止まった不整合を修復する。
    if (existing.invitation_id) {
      const { error: reconcileError } = await admin
        .from("user_invitations")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", existing.invitation_id)
        .eq("status", "pending");
      if (reconcileError) {
        console.error("既存ユーザーの招待状態を修復できませんでした", reconcileError);
        return {
          ok: false,
          reason: "error",
          message: "プロビジョニング状態を確認できませんでした。",
        };
      }
    }
    return { ok: true, appUser: existing };
  }

  // 2) 有効招待の消費・app_users作成をDB内の単一トランザクションで行う。
  // RPC自身もpending+期限内を再検査する(Before User Created Hookの多重防御)。
  const { data: created, error: provisioningError } = await admin.rpc(
    "accept_invitation_and_provision",
    {
      p_user_id: userId,
      p_email: email,
    },
  );

  if (provisioningError) {
    // 競合(すでに作成済み)なら再取得して成功扱い
    const { data: raced } = await admin
      .from("app_users")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (raced) {
      return { ok: true, appUser: raced };
    }
    if (provisioningError.code === "P0001") {
      return {
        ok: false,
        reason: "not_invited",
        message:
          "このアカウントは利用登録されていません。管理者にお問い合わせください。",
      };
    }
    return { ok: false, reason: "error", message: "プロビジョニングに失敗しました。" };
  }

  return { ok: true, appUser: created };
}
