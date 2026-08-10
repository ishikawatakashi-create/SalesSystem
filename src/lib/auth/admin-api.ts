import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import { invitationExpiresAt } from "@/lib/auth/config";
import { inviteRedirectUrl } from "@/lib/env";

export type AdminApiActor = {
  id: string;
  role: "admin" | "a" | "b" | "viewer";
  is_active: boolean;
};

export type InviteByEmailInput = {
  actor: AdminApiActor;
  email: string;
  displayName: string;
  role: "admin" | "a" | "b" | "viewer";
  invitationId: string;
};

export type AuthAdminResult =
  | { ok: true }
  | { ok: false; code: "duplicate" | "not_found" | "auth_error" };

export type CreatedAuthUserResult =
  | { ok: true; userId: string }
  | { ok: false; code: "duplicate" | "auth_error" };

export type PendingInviteAuthDeletionResult =
  | { ok: true; outcome: "deleted" | "not_found" }
  | {
      ok: false;
      code: "activated" | "mapping_mismatch" | "auth_error";
    };

export type RegisteredInviteAuthDeletionResult =
  | { ok: true; outcome: "deleted" | "not_found" }
  | { ok: false; code: "mapping_mismatch" | "auth_error" };

/**
 * Direct provisioning用のAuth identity作成。
 * 呼出元は admin-user-service のDB予約・権限検査を通過済みであること。
 * passwordはAuthへ渡すだけで、ログ・DB・auditへは渡さない。
 */
export async function createDirectAuthUser(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<CreatedAuthUserResult> {
  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({
    email: normalizeEmail(input.email),
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.displayName },
  });
  if (created.error || !created.data.user) {
    const code = String(created.error?.code ?? "").toLowerCase();
    const message = String(created.error?.message ?? "").toLowerCase();
    if (
      code.includes("already") ||
      code.includes("exists") ||
      message.includes("already") ||
      message.includes("exists") ||
      message.includes("registered")
    ) {
      return { ok: false, code: "duplicate" };
    }
    return { ok: false, code: "auth_error" };
  }
  return { ok: true, userId: created.data.user.id };
}

/** profile作成前に失敗したDirect Auth userだけを補償削除する。 */
export async function deleteIncompleteAuthUser(
  userId: string,
): Promise<AuthAdminResult> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (!error) return { ok: true };
  const code = String(error.code ?? "").toLowerCase();
  if (code.includes("not_found")) return { ok: false, code: "not_found" };
  return { ok: false, code: "auth_error" };
}

/**
 * 招待取消専用。Auth側でも未確認・未ログイン・招待ID一致を再確認し、
 * 1つでも曖昧ならdeleteUserを呼ばない。
 */
export async function deletePendingInvitedAuthUser(input: {
  userId: string;
  invitationId: string;
  normalizedEmail: string;
}): Promise<PendingInviteAuthDeletionResult> {
  const admin = createAdminClient();
  const current = await admin.auth.admin.getUserById(input.userId);
  if (current.error || !current.data.user) {
    const code = String(current.error?.code ?? "").toLowerCase();
    const message = String(current.error?.message ?? "").toLowerCase();
    if (code.includes("not_found") || message.includes("not found")) {
      return { ok: true, outcome: "not_found" };
    }
    return { ok: false, code: "auth_error" };
  }

  const authUser = current.data.user;
  const metadataInvitationId = String(
    authUser.user_metadata?.invitation_id ?? "",
  );
  if (
    normalizeEmail(authUser.email ?? "") !== input.normalizedEmail ||
    metadataInvitationId !== input.invitationId ||
    !authUser.invited_at
  ) {
    return { ok: false, code: "mapping_mismatch" };
  }
  if (
    authUser.email_confirmed_at ||
    authUser.confirmed_at ||
    authUser.last_sign_in_at
  ) {
    return { ok: false, code: "activated" };
  }

  const deleted = await admin.auth.admin.deleteUser(input.userId);
  if (!deleted.error) return { ok: true, outcome: "deleted" };

  const code = String(deleted.error.code ?? "").toLowerCase();
  const message = String(deleted.error.message ?? "").toLowerCase();
  if (code.includes("not_found") || message.includes("not found")) {
    return { ok: true, outcome: "not_found" };
  }
  return { ok: false, code: "auth_error" };
}

/**
 * 受諾済みの招待由来ユーザー専用のhard delete。
 * DB側で業務参照0とprofile削除を完了した後でも、AuthのID・email・招待IDを
 * 再検証する。soft deleteでは同じemailの再登録を保証できないため使用しない。
 */
export async function deleteRegisteredInvitedAuthUser(input: {
  userId: string;
  invitationId: string;
  normalizedEmail: string;
}): Promise<RegisteredInviteAuthDeletionResult> {
  const admin = createAdminClient();
  const current = await admin.auth.admin.getUserById(input.userId);
  if (current.error || !current.data.user) {
    const code = String(current.error?.code ?? "").toLowerCase();
    const message = String(current.error?.message ?? "").toLowerCase();
    if (code.includes("not_found") || message.includes("not found")) {
      return { ok: true, outcome: "not_found" };
    }
    return { ok: false, code: "auth_error" };
  }

  const authUser = current.data.user;
  if (
    normalizeEmail(authUser.email ?? "") !== input.normalizedEmail ||
    String(authUser.user_metadata?.invitation_id ?? "") !== input.invitationId ||
    !authUser.invited_at
  ) {
    return { ok: false, code: "mapping_mismatch" };
  }

  // falseを明示し、同じemailで再登録可能なhard deleteに固定する。
  const deleted = await admin.auth.admin.deleteUser(input.userId, false);
  if (!deleted.error) return { ok: true, outcome: "deleted" };

  // 通信切断などで応答だけ失われた場合も、実状態を再読して冪等に確定する。
  const after = await admin.auth.admin.getUserById(input.userId);
  if (after.error || !after.data.user) {
    const code = String(after.error?.code ?? "").toLowerCase();
    const message = String(after.error?.message ?? "").toLowerCase();
    if (code.includes("not_found") || message.includes("not found")) {
      return { ok: true, outcome: "deleted" };
    }
  }
  return { ok: false, code: "auth_error" };
}

export async function setAuthUserDisabled(input: {
  userId: string;
  disabled: boolean;
}): Promise<
  | { ok: true; previouslyBanned: boolean }
  | { ok: false; code: "not_found" | "auth_error" }
> {
  const admin = createAdminClient();
  const current = await admin.auth.admin.getUserById(input.userId);
  if (current.error || !current.data.user) {
    const code = String(current.error?.code ?? "").toLowerCase();
    return {
      ok: false,
      code: code.includes("not_found") ? "not_found" : "auth_error",
    };
  }
  const bannedUntil = current.data.user.banned_until;
  const previouslyBanned = Boolean(
    bannedUntil && new Date(bannedUntil).getTime() > Date.now(),
  );
  const updated = await admin.auth.admin.updateUserById(input.userId, {
    ban_duration: input.disabled ? "876000h" : "none",
  });
  if (updated.error) return { ok: false, code: "auth_error" };
  return { ok: true, previouslyBanned };
}

export async function resetAuthUserPassword(input: {
  userId: string;
  password: string;
}): Promise<AuthAdminResult> {
  const admin = createAdminClient();
  const updated = await admin.auth.admin.updateUserById(input.userId, {
    password: input.password,
  });
  if (!updated.error) return { ok: true };
  const code = String(updated.error.code ?? "").toLowerCase();
  return {
    ok: false,
    code: code.includes("not_found") ? "not_found" : "auth_error",
  };
}

/** app_usersがSSoT。Auth metadataは表示補助としてbest-effort同期する。 */
export async function syncAuthUserDisplayName(input: {
  userId: string;
  displayName: string;
}): Promise<AuthAdminResult> {
  const admin = createAdminClient();
  const updated = await admin.auth.admin.updateUserById(input.userId, {
    user_metadata: { display_name: input.displayName },
  });
  return updated.error
    ? { ok: false, code: "auth_error" }
    : { ok: true };
}

export async function listAuthUserActivity(): Promise<
  Map<string, { lastSignInAt: string | null }>
> {
  const admin = createAdminClient();
  const result = new Map<string, { lastSignInAt: string | null }>();
  const perPage = 1_000;
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) break;
    for (const user of data.users) {
      result.set(user.id, { lastSignInAt: user.last_sign_in_at ?? null });
    }
    if (data.users.length < perPage) break;
  }
  return result;
}

/**
 * Auth Admin APIの唯一の入口。
 * createUser / inviteUserByEmail の直接呼び出しを禁止し、ここへ集約する。
 * Before User Created Hookは createUser を迂回するため、通常作成前に
 * pending招待・期限・メール一致を必ず検証する。
 */
export async function inviteUserByEmailSafe(
  input: InviteByEmailInput,
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  if (!input.actor.is_active || input.actor.role !== "admin") {
    return { ok: false, message: "管理者権限が必要です" };
  }

  const admin = createAdminClient();
  const normalized = normalizeEmail(input.email);
  const { data: invitation, error } = await admin
    .from("user_invitations")
    .select("id,normalized_email,status,expires_at,role")
    .eq("id", input.invitationId)
    .maybeSingle();

  if (error || !invitation) {
    return { ok: false, message: "招待レコードが見つかりません" };
  }
  if (invitation.status !== "pending") {
    return { ok: false, message: "有効なpending招待ではありません" };
  }
  if (new Date(invitation.expires_at).getTime() < Date.now()) {
    return { ok: false, message: "招待の有効期限が切れています" };
  }
  if (invitation.normalized_email !== normalized) {
    return { ok: false, message: "招待メールと一致しません" };
  }

  const { data: inviteData, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(
      normalized,
      {
        data: {
          display_name: input.displayName,
          invitation_id: input.invitationId,
          invitation_source: "sales_system",
        },
        // Supabase標準テンプレート({{ .ConfirmationURL }})はimplicit flowで
        // URL fragmentへsessionを返すため、まずブラウザ側routeでcookie化する。
        redirectTo: inviteRedirectUrl(),
      },
    );
  if (inviteError || !inviteData.user) {
    return { ok: false, message: "招待メールを送信できませんでした" };
  }

  const { data: linked, error: linkError } = await admin
    .from("user_invitations")
    .update({ auth_user_id: inviteData.user.id })
    .eq("id", input.invitationId)
    .eq("status", "pending")
    .is("auth_user_id", null)
    .select("id")
    .maybeSingle();
  if (linkError || !linked) {
    // メールは送信済みでも、対応関係を永続化できなければリンクを無効化する。
    await deletePendingInvitedAuthUser({
      userId: inviteData.user.id,
      invitationId: input.invitationId,
      normalizedEmail: normalized,
    });
    return {
      ok: false,
      message: "招待ユーザーとの対応を安全に保存できませんでした",
    };
  }

  await admin.from("audit_logs").insert({
    actor_id: input.actor.id,
    actor_name: null,
    action: "user.invite",
    entity_type: "user_invitation",
    changed_fields: {
      invitation_id: input.invitationId,
      auth_user_id: inviteData.user.id,
      role: input.role,
    },
    operation_source: "admin_api_wrapper",
    batch_id: null,
    request_id: null,
    notion_page_id: null,
  });

  return { ok: true, userId: inviteData.user.id };
}

/**
 * 初回管理者bootstrap。
 * active adminが0件、かつ AUTH_BOOTSTRAP_ADMIN_EMAIL と一致する場合のみ。
 */
export async function bootstrapFirstAdmin(input: {
  email: string;
  displayName: string;
  password: string;
}): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const allowed = process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
  if (!allowed) {
    return { ok: false, message: "AUTH_BOOTSTRAP_ADMIN_EMAILが未設定です" };
  }
  const normalized = normalizeEmail(input.email);
  if (normalizeEmail(allowed) !== normalized) {
    return { ok: false, message: "bootstrap許可メールと一致しません" };
  }

  const admin = createAdminClient();
  const { count, error: countError } = await admin
    .from("app_users")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("is_active", true);
  if (countError) {
    return { ok: false, message: "管理者件数の確認に失敗しました" };
  }
  if ((count ?? 0) > 0) {
    return { ok: false, message: "既にactive adminが存在します" };
  }

  // 招待を確保
  const expiresAt = invitationExpiresAt(new Date());
  await admin
    .from("user_invitations")
    .update({ status: "expired" })
    .eq("normalized_email", normalized)
    .eq("status", "pending");

  const { data: invitation, error: invError } = await admin
    .from("user_invitations")
    .insert({
      email: input.email,
      normalized_email: normalized,
      display_name: input.displayName,
      role: "admin",
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (invError || !invitation) {
    return { ok: false, message: "bootstrap招待の作成に失敗しました" };
  }

  const created = await admin.auth.admin.createUser({
    email: normalized,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.displayName },
  });
  if (created.error || !created.data.user) {
    return { ok: false, message: "bootstrapユーザー作成に失敗しました" };
  }

  const provisioned = await admin.rpc("accept_invitation_and_provision", {
    p_user_id: created.data.user.id,
    p_email: normalized,
  });
  if (provisioned.error) {
    return { ok: false, message: "bootstrapプロビジョニングに失敗しました" };
  }

  await admin.from("audit_logs").insert({
    actor_id: created.data.user.id,
    actor_name: input.displayName,
    action: "user.bootstrap",
    entity_type: "app_user",
    changed_fields: { bootstrap: true },
    operation_source: "admin_api_wrapper",
    batch_id: null,
    request_id: null,
    notion_page_id: null,
  });

  return { ok: true, userId: created.data.user.id };
}
