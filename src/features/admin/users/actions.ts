"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser, requirePermission, AuthError } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import { invitationExpiresAt } from "@/lib/auth/config";
import { inviteUserByEmailSafe } from "@/lib/auth/admin-api";
import { updateUserDisplayName } from "@/lib/auth/update-display-name";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/auth/display-name";
import {
  archiveInvitationHistory,
  cancelPendingInvitation,
} from "@/lib/auth/invitation-admin-service";
import {
  changeUserRole,
  getUserDisableImpact,
  provisionUserDirectly,
  resetUserPasswordByAdmin,
  setUserActiveState,
  type DisableImpact,
} from "@/lib/auth/admin-user-service";
import {
  permanentlyDeleteInvitedUser,
  type PermanentDeleteReason,
} from "@/lib/auth/permanent-user-deletion-service";

export type ActionResult =
  | {
      ok: true;
      message: string;
      displayName?: string;
      userId?: string;
      impact?: DisableImpact;
    }
  | { ok: false; message: string };

export async function createUserDirectAction(input: unknown): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "user.manage");
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, message: e.message };
    throw e;
  }

  const raw = (input ?? {}) as Record<string, unknown>;
  const result = await provisionUserDirectly({
    actor: {
      id: user.id,
      role: user.role,
      is_active: user.is_active,
      display_name: user.display_name,
    },
    requestId: String(raw.requestId ?? ""),
    displayName: String(raw.displayName ?? ""),
    email: String(raw.email ?? ""),
    password: String(raw.password ?? ""),
    role: String(raw.role ?? "") as "admin" | "a" | "b" | "viewer",
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/admin/users");
  return { ok: true, message: result.message, userId: result.userId };
}

const targetUserSchema = z.object({ targetUserId: z.uuid() });

export async function getDisableImpactAction(input: unknown): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "user.manage");
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, message: e.message };
    throw e;
  }
  const parsed = targetUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "ユーザーが見つかりません" };
  const result = await getUserDisableImpact({
    actor: user,
    targetUserId: parsed.data.targetUserId,
  });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, message: result.message, impact: result.impact };
}

const activeStateSchema = targetUserSchema.extend({ active: z.boolean() });

export async function setUserActiveAction(input: unknown): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "user.manage");
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, message: e.message };
    throw e;
  }
  const parsed = activeStateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "入力内容を確認してください" };
  const result = await setUserActiveState({
    actor: user,
    targetUserId: parsed.data.targetUserId,
    active: parsed.data.active,
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/admin/users");
  revalidatePath("/", "layout");
  return result;
}

const permanentDeleteSchema = targetUserSchema.extend({
  reason: z.enum(["re-register", "mistaken_invitation", "test"]),
  confirmation: z.literal("削除する"),
});

export async function permanentlyDeleteUserAction(
  input: unknown,
): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "user.manage");
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, message: e.message };
    throw e;
  }

  const parsed = permanentDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "確認入力と削除理由を確認してください。" };
  }
  const result = await permanentlyDeleteInvitedUser({
    actor: user,
    targetUserId: parsed.data.targetUserId,
    reason: parsed.data.reason as PermanentDeleteReason,
  });
  revalidatePath("/admin/users");
  revalidatePath("/", "layout");
  return result;
}

const roleChangeSchema = targetUserSchema.extend({
  role: z.enum(["admin", "a", "b", "viewer"]),
});

export async function changeUserRoleAction(input: unknown): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "user.manage");
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, message: e.message };
    throw e;
  }
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "入力内容を確認してください" };
  const result = await changeUserRole({
    actor: user,
    targetUserId: parsed.data.targetUserId,
    role: parsed.data.role,
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/admin/users");
  revalidatePath("/", "layout");
  return result;
}

const passwordResetSchema = targetUserSchema.extend({
  password: z.string(),
  confirmation: z.string(),
});

export async function resetUserPasswordAction(input: unknown): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "user.manage");
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, message: e.message };
    throw e;
  }
  const parsed = passwordResetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "入力内容を確認してください" };
  if (parsed.data.password !== parsed.data.confirmation) {
    return { ok: false, message: "確認用パスワードが一致しません" };
  }
  const result = await resetUserPasswordByAdmin({
    actor: user,
    targetUserId: parsed.data.targetUserId,
    password: parsed.data.password,
  });
  return result.ok ? result : { ok: false, message: result.message };
}

const inviteSchema = z.object({
  email: z.email("メールアドレスの形式が正しくありません"),
  displayName: z
    .string()
    .trim()
    .min(1, "表示名を入力してください")
    .max(DISPLAY_NAME_MAX_LENGTH, `表示名は${DISPLAY_NAME_MAX_LENGTH}文字以内にしてください`),
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

  // 2) 招待メール送信(Auth Adminはserver-onlyラッパー経由。Hook迂回対策の検証込み)
  const inviteResult = await inviteUserByEmailSafe({
    actor: {
      id: user.id,
      role: user.role,
      is_active: user.is_active,
    },
    email: normalized,
    displayName,
    role,
    invitationId: invitation.id,
  });

  if (!inviteResult.ok) {
    await admin
      .from("user_invitations")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", invitation.id)
      .eq("status", "pending");
    return {
      ok: false,
      message: inviteResult.message,
    };
  }

  revalidatePath("/admin/users");
  return { ok: true, message: `${email} に招待メールを送信しました。` };
}

const revokeSchema = z.object({ invitationId: z.uuid() });

/** pending招待の安全な取消。Auth削除条件はserver-only serviceとDB RPCで再検証する。 */
export async function revokeInvitationAction(
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

  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "指定された招待が見つかりません。" };
  }

  const result = await cancelPendingInvitation({
    actor: user,
    invitationId: parsed.data.invitationId,
  });

  revalidatePath("/admin/users");
  return result;
}

/** 受諾済み・取消済み・期限切れの招待履歴だけを管理画面から非表示にする。 */
export async function archiveInvitationHistoryAction(
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

  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "指定された招待が見つかりません。" };
  }

  const result = await archiveInvitationHistory({
    actor: user,
    invitationId: parsed.data.invitationId,
  });
  revalidatePath("/admin/users");
  return result;
}

const renameSchema = z.object({
  /** 信用しない。server 側で session と照合する */
  targetUserId: z.uuid(),
  displayName: z.string(),
});

/**
 * 表示名変更。
 * admin は全員、それ以外は自分自身のみ。
 * UI 非表示だけでなくここで必ず拒否する。
 */
export async function updateDisplayNameAction(
  input: unknown,
): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, message: e.message };
    }
    throw e;
  }

  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "入力内容を確認してください" };
  }

  const result = await updateUserDisplayName({
    actor: {
      id: user.id,
      role: user.role,
      display_name: user.display_name,
    },
    targetUserId: parsed.data.targetUserId,
    displayName: parsed.data.displayName,
  });

  if (!result.ok) return result;

  revalidatePath("/admin/users");
  revalidatePath("/settings/profile");
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: "表示名を更新しました",
    displayName: result.displayName,
  };
}

const inviteRenameSchema = z.object({
  invitationId: z.uuid(),
  displayName: z.string(),
});

/** 未受諾(pending)招待の表示名のみ admin が編集可能 */
export async function updateInvitationDisplayNameAction(
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

  const parsed = inviteRenameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "入力内容を確認してください" };
  }

  const { validateDisplayName } = await import("@/lib/auth/display-name");
  const validated = validateDisplayName(parsed.data.displayName);
  if (!validated.ok) return validated;

  const admin = createAdminClient();
  const { data: inv, error: readErr } = await admin
    .from("user_invitations")
    .select("id,display_name,status")
    .eq("id", parsed.data.invitationId)
    .maybeSingle();
  if (readErr || !inv) {
    return { ok: false, message: "招待が見つかりません" };
  }
  if (inv.status !== "pending") {
    return {
      ok: false,
      message: "受諾済み・取消済み・期限切れの招待表示名は変更できません",
    };
  }

  const oldName = String(inv.display_name ?? "");
  const { error } = await admin
    .from("user_invitations")
    .update({ display_name: validated.value })
    .eq("id", inv.id)
    .eq("status", "pending");
  if (error) {
    return { ok: false, message: "招待の表示名を更新できませんでした" };
  }

  await admin.from("audit_logs").insert({
    actor_id: user.id,
    actor_name: user.display_name,
    action: "user_invitation.display_name_change",
    entity_type: "user_invitation",
    notion_page_id: null,
    changed_fields: {
      invitation_id: inv.id,
      old_display_name: oldName,
      new_display_name: validated.value,
    },
    operation_source: "app",
    request_id: null,
    batch_id: null,
  });

  revalidatePath("/admin/users");
  return { ok: true, message: "招待の表示名を更新しました", displayName: validated.value };
}
