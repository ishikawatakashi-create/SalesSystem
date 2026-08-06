import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import { invitationExpiresAt } from "@/lib/auth/config";
import { appUrl } from "@/lib/env";

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

/**
 * Auth Admin APIの唯一の入口。
 * createUser / inviteUserByEmail の直接呼び出しを禁止し、ここへ集約する。
 * Before User Created Hookは createUser を迂回するため、通常作成前に
 * pending招待・期限・メール一致を必ず検証する。
 */
export async function inviteUserByEmailSafe(
  input: InviteByEmailInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
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

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    normalized,
    {
      data: { display_name: input.displayName },
      redirectTo: `${appUrl()}/auth/callback`,
    },
  );
  if (inviteError) {
    return { ok: false, message: "招待メールを送信できませんでした" };
  }

  await admin.from("audit_logs").insert({
    actor_id: input.actor.id,
    actor_name: null,
    action: "user.invite",
    entity_type: "user_invitation",
    changed_fields: {
      invitation_id: input.invitationId,
      role: input.role,
    },
    operation_source: "admin_api_wrapper",
    batch_id: null,
    request_id: null,
    notion_page_id: null,
  });

  return { ok: true };
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
