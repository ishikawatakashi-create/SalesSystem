import "server-only";

import { z } from "zod";

import {
  createDirectAuthUser,
  deleteIncompleteAuthUser,
  resetAuthUserPassword,
  setAuthUserDisabled,
} from "@/lib/auth/admin-api";
import { DISPLAY_NAME_MAX_LENGTH, validateDisplayName } from "@/lib/auth/display-name";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole, AppUserRow } from "@/types/database";

export const AUTH_PASSWORD_MIN_LENGTH = 6;

export type AdminUserActor = Pick<
  AppUserRow,
  "id" | "role" | "is_active" | "display_name"
>;

export type AdminUserResult<T = undefined> =
  | ({ ok: true; message: string } & (T extends undefined ? object : T))
  | { ok: false; message: string; code?: string };

const roleSchema = z.enum(["admin", "a", "b", "viewer"]);
const emailSchema = z
  .string()
  .trim()
  .pipe(z.email("メールアドレスの形式が正しくありません"));
const passwordSchema = z
  .string()
  .min(
    AUTH_PASSWORD_MIN_LENGTH,
    `パスワードは${AUTH_PASSWORD_MIN_LENGTH}文字以上にしてください`,
  );

const directCreateSchema = z.object({
  requestId: z.uuid("作成リクエストが正しくありません"),
  displayName: z
    .string()
    .trim()
    .min(1, "表示名を入力してください")
    .max(
      DISPLAY_NAME_MAX_LENGTH,
      `表示名は${DISPLAY_NAME_MAX_LENGTH}文字以内にしてください`,
    ),
  email: emailSchema,
  password: passwordSchema,
  role: roleSchema,
});

function firstValidationMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "入力内容を確認してください";
}

function isAdmin(actor: AdminUserActor): boolean {
  return actor.is_active && actor.role === "admin";
}

function rpcMessage(error: { message?: string } | null): string {
  return String(error?.message ?? "").toLowerCase();
}

function mapMutationError(error: { message?: string } | null): AdminUserResult {
  const message = rpcMessage(error);
  if (message.includes("self_disable")) {
    return { ok: false, code: "self_disable", message: "自分自身を利用停止することはできません" };
  }
  if (message.includes("self_demote")) {
    return { ok: false, code: "self_demote", message: "自分自身の管理者権限を解除することはできません" };
  }
  if (message.includes("last_admin")) {
    return { ok: false, code: "last_admin", message: "少なくとも1人の管理者が必要です" };
  }
  if (message.includes("already_inactive")) {
    return { ok: false, code: "already_inactive", message: "このユーザーは既に利用停止されています" };
  }
  if (message.includes("already_active")) {
    return { ok: false, code: "already_active", message: "このユーザーは既に有効です" };
  }
  if (message.includes("role_unchanged")) {
    return { ok: false, code: "role_unchanged", message: "権限は変更されていません" };
  }
  if (message.includes("user_not_found")) {
    return { ok: false, code: "not_found", message: "ユーザーが見つかりません" };
  }
  if (message.includes("admin_required")) {
    return { ok: false, code: "forbidden", message: "管理者権限が必要です" };
  }
  return { ok: false, code: "operation_failed", message: "ユーザー情報を更新できませんでした" };
}

async function markDirectCreateFailed(
  actorId: string,
  requestId: string,
  errorCode: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin.rpc("fail_direct_user_provisioning", {
    p_actor_id: actorId,
    p_request_id: requestId,
    p_error_code: errorCode,
  });
}

/**
 * 管理者による直接アカウント作成。
 * Before User Created Hookを迂回するAdmin APIの前後を、DB予約と補償で閉じる。
 */
export async function provisionUserDirectly(input: {
  actor: AdminUserActor;
  requestId: string;
  displayName: string;
  email: string;
  password: string;
  role: AppRole;
}): Promise<AdminUserResult<{ userId: string }>> {
  if (!isAdmin(input.actor)) {
    return { ok: false, code: "forbidden", message: "管理者権限が必要です" };
  }

  const parsed = directCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation", message: firstValidationMessage(parsed.error) };
  }
  const displayName = validateDisplayName(parsed.data.displayName);
  if (!displayName.ok) return { ok: false, code: "validation", message: displayName.message };

  const normalizedEmail = normalizeEmail(parsed.data.email);
  const admin = createAdminClient();
  const begun = await admin.rpc("begin_direct_user_provisioning", {
    p_actor_id: input.actor.id,
    p_request_id: parsed.data.requestId,
    p_email: normalizedEmail,
  });
  if (begun.error) {
    const message = rpcMessage(begun.error);
    if (message.includes("email_registered")) {
      const { data: existing } = await admin
        .from("app_users")
        .select("is_active")
        .ilike("email", normalizedEmail)
        .maybeSingle();
      if (existing && !existing.is_active) {
        return {
          ok: false,
          code: "inactive_duplicate",
          message: "このユーザーは利用停止中です。再有効化してください",
        };
      }
      return {
        ok: false,
        code: "duplicate",
        message: "このメールアドレスは既に登録されています",
      };
    }
    if (message.includes("email_provisioning")) {
      return { ok: false, code: "processing", message: "このメールアドレスの作成処理が進行中です" };
    }
    return mapMutationError(begun.error) as AdminUserResult<{ userId: string }>;
  }

  if (begun.data === "completed") {
    const { data: operation } = await admin
      .from("user_admin_operations")
      .select("target_user_id")
      .eq("request_id", parsed.data.requestId)
      .maybeSingle();
    if (operation?.target_user_id) {
      return {
        ok: true,
        userId: operation.target_user_id,
        message: "ユーザーは既に作成されています",
      };
    }
  }
  if (begun.data === "processing") {
    return { ok: false, code: "processing", message: "ユーザーの作成処理が進行中です" };
  }
  if (begun.data !== "started") {
    return { ok: false, code: "operation_failed", message: "ユーザーの作成を開始できませんでした" };
  }

  const authCreated = await createDirectAuthUser({
    email: normalizedEmail,
    password: parsed.data.password,
    displayName: displayName.value,
  });
  if (!authCreated.ok) {
    await markDirectCreateFailed(
      input.actor.id,
      parsed.data.requestId,
      authCreated.code,
    );
    return authCreated.code === "duplicate"
      ? { ok: false, code: "duplicate", message: "このメールアドレスは既に登録されています" }
      : { ok: false, code: "auth_error", message: "ユーザーの作成に失敗しました" };
  }

  const completed = await admin.rpc("complete_direct_user_provisioning", {
    p_actor_id: input.actor.id,
    p_request_id: parsed.data.requestId,
    p_user_id: authCreated.userId,
    p_email: normalizedEmail,
    p_display_name: displayName.value,
    p_role: parsed.data.role,
  });
  if (completed.error) {
    // 応答断などでcommit済みの可能性を先に照合し、成功済みAuthを消さない。
    const { data: reconciled } = await admin
      .from("app_users")
      .select("id")
      .eq("id", authCreated.userId)
      .maybeSingle();
    if (reconciled) {
      return { ok: true, userId: authCreated.userId, message: "ユーザーを作成しました" };
    }

    const compensated = await deleteIncompleteAuthUser(authCreated.userId);
    if (!compensated.ok) {
      // 物理削除に失敗してもログイン不能にし、未プロビジョニング一覧で検知可能にする。
      await setAuthUserDisabled({ userId: authCreated.userId, disabled: true });
      await markDirectCreateFailed(input.actor.id, parsed.data.requestId, "compensation_failed");
      return {
        ok: false,
        code: "compensation_failed",
        message: "ユーザー作成を完了できませんでした。管理者に確認してください",
      };
    }
    await markDirectCreateFailed(input.actor.id, parsed.data.requestId, "profile_failed");
    return { ok: false, code: "profile_failed", message: "ユーザーの作成に失敗しました" };
  }

  return { ok: true, userId: authCreated.userId, message: "ユーザーを作成しました" };
}

export async function setUserActiveState(input: {
  actor: AdminUserActor;
  targetUserId: string;
  active: boolean;
}): Promise<AdminUserResult> {
  if (!isAdmin(input.actor)) {
    return { ok: false, code: "forbidden", message: "管理者権限が必要です" };
  }
  if (!z.uuid().safeParse(input.targetUserId).success) {
    return { ok: false, code: "validation", message: "ユーザーが見つかりません" };
  }
  if (!input.active && input.targetUserId === input.actor.id) {
    return { ok: false, code: "self_disable", message: "自分自身を利用停止することはできません" };
  }

  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin
    .from("app_users")
    .select("id,role,is_active")
    .eq("id", input.targetUserId)
    .maybeSingle();
  if (targetError || !target) {
    return { ok: false, code: "not_found", message: "ユーザーが見つかりません" };
  }
  if (target.is_active === input.active) {
    return input.active
      ? { ok: false, code: "already_active", message: "このユーザーは既に有効です" }
      : { ok: false, code: "already_inactive", message: "このユーザーは既に利用停止されています" };
  }
  if (!input.active && target.role === "admin") {
    const { count } = await admin
      .from("app_users")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      return { ok: false, code: "last_admin", message: "少なくとも1人の管理者が必要です" };
    }
  }

  const authChanged = await setAuthUserDisabled({
    userId: input.targetUserId,
    disabled: !input.active,
  });
  if (!authChanged.ok) {
    return { ok: false, code: authChanged.code, message: "Authの利用状態を変更できませんでした" };
  }

  const changed = await admin.rpc("set_app_user_active", {
    p_actor_id: input.actor.id,
    p_target_user_id: input.targetUserId,
    p_active: input.active,
  });
  if (changed.error) {
    const shouldRestoreDisabled = authChanged.previouslyBanned;
    await setAuthUserDisabled({
      userId: input.targetUserId,
      disabled: shouldRestoreDisabled,
    });
    return mapMutationError(changed.error);
  }

  return {
    ok: true,
    message: input.active ? "ユーザーを再有効化しました" : "ユーザーを利用停止しました",
  };
}

export async function changeUserRole(input: {
  actor: AdminUserActor;
  targetUserId: string;
  role: AppRole;
}): Promise<AdminUserResult> {
  if (!isAdmin(input.actor)) {
    return { ok: false, code: "forbidden", message: "管理者権限が必要です" };
  }
  const parsed = z.object({ targetUserId: z.uuid(), role: roleSchema }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation", message: "入力内容を確認してください" };
  }
  if (input.targetUserId === input.actor.id && input.role !== "admin") {
    return { ok: false, code: "self_demote", message: "自分自身の管理者権限を解除することはできません" };
  }

  const admin = createAdminClient();
  const changed = await admin.rpc("change_app_user_role", {
    p_actor_id: input.actor.id,
    p_target_user_id: input.targetUserId,
    p_role: input.role,
  });
  if (changed.error) return mapMutationError(changed.error);
  return { ok: true, message: "権限を変更しました" };
}

export async function resetUserPasswordByAdmin(input: {
  actor: AdminUserActor;
  targetUserId: string;
  password: string;
}): Promise<AdminUserResult> {
  if (!isAdmin(input.actor)) {
    return { ok: false, code: "forbidden", message: "管理者権限が必要です" };
  }
  const parsed = z
    .object({ targetUserId: z.uuid(), password: passwordSchema })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation", message: firstValidationMessage(parsed.error) };
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("app_users")
    .select("id")
    .eq("id", input.targetUserId)
    .maybeSingle();
  if (!target) return { ok: false, code: "not_found", message: "ユーザーが見つかりません" };

  const changed = await resetAuthUserPassword({
    userId: input.targetUserId,
    password: parsed.data.password,
  });
  if (!changed.ok) {
    return { ok: false, code: changed.code, message: "パスワードを変更できませんでした" };
  }

  const audited = await admin.rpc("record_admin_password_reset", {
    p_actor_id: input.actor.id,
    p_target_user_id: input.targetUserId,
  });
  if (audited.error) {
    return {
      ok: false,
      code: "audit_failed",
      message: "パスワードは変更されましたが、監査記録を確認できませんでした",
    };
  }
  return { ok: true, message: "パスワードを再設定しました" };
}

export type DisableImpact = {
  deals: number;
  actions: number;
  prospects: number;
  inquiries: number;
};

export async function getUserDisableImpact(input: {
  actor: AdminUserActor;
  targetUserId: string;
}): Promise<AdminUserResult<{ impact: DisableImpact }>> {
  if (!isAdmin(input.actor)) {
    return { ok: false, code: "forbidden", message: "管理者権限が必要です" };
  }
  if (!z.uuid().safeParse(input.targetUserId).success) {
    return { ok: false, code: "validation", message: "ユーザーが見つかりません" };
  }
  const admin = createAdminClient();
  const [deals, actions, prospects, inquiries] = await Promise.all([
    admin
      .from("deal_index")
      .select("notion_page_id", { count: "exact", head: true })
      .contains("staff_user_ids", [input.targetUserId])
      .in("status_semantic", ["active", "on_hold"]),
    admin
      .from("action_index")
      .select("notion_page_id", { count: "exact", head: true })
      .eq("assignee_user_id", input.targetUserId)
      .eq("is_open", true),
    admin
      .from("prospect_list_memberships")
      .select("id", { count: "exact", head: true })
      .eq("assigned_user_id", input.targetUserId)
      .is("archived_at", null)
      .in("stage", ["new", "assigned", "working", "qualified"]),
    admin
      .from("inquiries")
      .select("id", { count: "exact", head: true })
      .eq("assigned_user_id", input.targetUserId)
      .in("status", ["new", "in_progress"]),
  ]);
  if ([deals, actions, prospects, inquiries].some((result) => result.error)) {
    return { ok: false, code: "impact_failed", message: "担当中データを確認できませんでした" };
  }
  return {
    ok: true,
    message: "担当中データを確認しました",
    impact: {
      deals: deals.count ?? 0,
      actions: actions.count ?? 0,
      prospects: prospects.count ?? 0,
      inquiries: inquiries.count ?? 0,
    },
  };
}
