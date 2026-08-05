import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import { isInvitationUsable } from "@/lib/auth/invitation-logic";
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
 * 注: Notion自社担当者ページの作成はPhase 1のNotion接続ステップで実装し、
 * 既存ユーザーへはバックフィルジョブ(user_provisioning)で適用する。
 * それまでは app_users 作成完了をもって completed とする。
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
    return { ok: true, appUser: existing };
  }

  // 2) 有効な招待を照合(Before User Created Hookの多重防御)
  const normalized = normalizeEmail(email);
  const { data: invitation, error: invError } = await admin
    .from("user_invitations")
    .select("*")
    .eq("normalized_email", normalized)
    .eq("status", "pending")
    .maybeSingle();

  if (invError) {
    return { ok: false, reason: "error", message: invError.message };
  }
  if (!invitation || !isInvitationUsable(invitation)) {
    return {
      ok: false,
      reason: "not_invited",
      message:
        "このアカウントは利用登録されていません。管理者にお問い合わせください。",
    };
  }

  // 3) app_users作成(同時ログインの競合はPK衝突で片方が失敗 → 再取得)
  const { data: created, error: insertError } = await admin
    .from("app_users")
    .insert({
      id: userId,
      email,
      display_name: invitation.display_name,
      role: invitation.role,
      provisioning_status: "completed",
      invitation_id: invitation.id,
    })
    .select("*")
    .single();

  if (insertError) {
    // 競合(すでに作成済み)なら再取得して成功扱い
    const { data: raced } = await admin
      .from("app_users")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (raced) {
      return { ok: true, appUser: raced };
    }
    return { ok: false, reason: "error", message: insertError.message };
  }

  // 4) 招待を受諾済みへ(失敗しても利用は妨げない。日次ジョブで整合)
  await admin
    .from("user_invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invitation.id)
    .eq("status", "pending");

  return { ok: true, appUser: created };
}
