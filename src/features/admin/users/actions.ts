"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser, requirePermission, AuthError } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import { invitationExpiresAt } from "@/lib/auth/config";
import { appUrl } from "@/lib/env";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const inviteSchema = z.object({
  email: z.email("メールアドレスの形式が正しくありません"),
  displayName: z
    .string()
    .trim()
    .min(1, "表示名を入力してください")
    .max(100, "表示名は100文字以内にしてください"),
  role: z.enum(["admin", "a", "b", "viewer"]),
});

/**
 * ユーザー招待。
 * 1. user_invitationsへpendingの招待を登録(招待の正)
 * 2. inviteUserByEmailで招待メールを送信
 * Before User Created Hookは1の登録を参照して未招待ユーザーを拒否するため、
 * 必ずこの順序で実行する(docs/permissions.md §5)。
 */
export async function inviteUserAction(
  input: unknown,
): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "user.manage");
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, message: e.message };
    }
    throw e;
  }

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, message: first?.message ?? "入力内容を確認してください" };
  }
  const { email, displayName, role } = parsed.data;
  const normalized = normalizeEmail(email);

  const admin = createAdminClient();

  // Authリンクの期限切れ後に再招待できるよう、同じメールの期限超過pendingを
  // expiredへ遷移する。Authユーザーは自動削除しない。
  const now = new Date();
  const { error: expireError } = await admin
    .from("user_invitations")
    .update({ status: "expired" })
    .eq("normalized_email", normalized)
    .eq("status", "pending")
    .lt("expires_at", now.toISOString());

  if (expireError) {
    console.error("期限切れ招待の状態更新に失敗しました", expireError);
    return {
      ok: false,
      message: "招待を開始できませんでした。時間をおいて再度お試しください。",
    };
  }

  let expiresAt: string;
  try {
    expiresAt = invitationExpiresAt(now);
  } catch (error) {
    console.error("招待期限の設定が不正です", error);
    return {
      ok: false,
      message: "招待期限のシステム設定が完了していません。管理者に確認してください。",
    };
  }

  // 1) 招待レコード登録(pending一意制約が期限内の二重招待を防ぐ)
  const { data: invitation, error: insertError } = await admin
    .from("user_invitations")
    .insert({
      email,
      normalized_email: normalized,
      display_name: displayName,
      role,
      invited_by: user.id,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        ok: false,
        message: "このメールアドレスには有効な招待が既に存在します。",
      };
    }
    console.error("招待レコードの登録に失敗しました", insertError);
    return {
      ok: false,
      message: "招待を登録できませんでした。時間をおいて再度お試しください。",
    };
  }

  // 2) 招待メール送信(Auth側にユーザーを仮作成し、招待リンクを送る)
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    normalized,
    {
      data: { display_name: displayName },
      redirectTo: `${appUrl()}/auth/callback`,
    },
  );

  if (inviteError) {
    // メール送信に失敗した場合は招待レコードを取り消して整合を保つ
    await admin
      .from("user_invitations")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", invitation.id)
      .eq("status", "pending");
    console.error("Supabase Authの招待メール送信に失敗しました", inviteError);
    return {
      ok: false,
      message: "招待メールを送信できませんでした。設定を確認してください。",
    };
  }

  revalidatePath("/admin/users");
  return { ok: true, message: `${email} に招待メールを送信しました。` };
}

const revokeSchema = z.object({ invitationId: z.uuid() });

/** 招待の取消(pending → revoked)。取消後はそのメールでの新規ログインが不可になる。 */
export async function revokeInvitationAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "user.manage");
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, message: e.message };
    }
    throw e;
  }

  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "指定された招待が見つかりません。" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.invitationId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    console.error("招待の取消に失敗しました", error);
    return {
      ok: false,
      message: "招待を取り消せませんでした。時間をおいて再度お試しください。",
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, message: "取消できる状態の招待が見つかりません。" };
  }

  revalidatePath("/admin/users");
  return { ok: true, message: "招待を取り消しました。" };
}
