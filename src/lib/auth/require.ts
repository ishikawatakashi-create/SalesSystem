import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AppUserRow } from "@/types/database";
import { hasPermission, type PermissionAction } from "@/lib/auth/permissions";

export class AuthError extends Error {
  constructor(
    public readonly code:
      | "unauthenticated"
      | "inactive"
      | "not_provisioned"
      | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * 認証済み・有効・プロビジョニング完了のアプリユーザーを取得する。
 * すべてのServer Action / Route Handlerの冒頭で必ず呼ぶこと。
 * getSession()は信用せず、getUser()でSupabaseに対して検証する。
 */
export async function requireUser(): Promise<AppUserRow> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new AuthError("unauthenticated", "ログインが必要です。");
  }

  // 自分の行はRLSポリシー(id = auth.uid())で読める
  const { data: appUser } = await supabase
    .from("app_users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!appUser) {
    throw new AuthError(
      "not_provisioned",
      "アカウントの準備が完了していません。管理者にお問い合わせください。",
    );
  }
  if (!appUser.is_active) {
    throw new AuthError(
      "inactive",
      "このアカウントは無効化されています。管理者にお問い合わせください。",
    );
  }
  if (appUser.provisioning_status !== "completed") {
    throw new AuthError(
      "not_provisioned",
      "アカウントの準備中です。しばらくしてから再度お試しください。",
    );
  }
  return appUser;
}

/**
 * 権限チェック。UIの表示制御とは独立して、サーバー側で必ず実行する。
 * Secret key経由の操作はRLSに守られないため、この関数が実質的な防御線となる
 * (docs/permissions.md)。
 */
export function requirePermission(
  user: AppUserRow,
  action: PermissionAction,
): void {
  if (!hasPermission(user.role, action)) {
    throw new AuthError("forbidden", "この操作を行う権限がありません。");
  }
}
