import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type UnprovisionedAuthUser = {
  id: string;
  email: string | null;
  createdAt: string;
};

/**
 * auth.usersには存在するがapp_usersに存在しないユーザーを検知する。
 *
 * 初期版では誤削除を避けるため自動削除しない。管理者が招待・Hook・
 * プロビジョニング履歴を確認するための表示専用情報として扱う。
 */
export async function listUnprovisionedAuthUsers(): Promise<
  UnprovisionedAuthUser[]
> {
  const admin = createAdminClient();
  const [{ data: authData, error: authError }, { data: appUsers, error: appError }] =
    await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
      admin.from("app_users").select("id"),
    ]);

  if (authError || appError) {
    console.error("未プロビジョニングAuthユーザーの検知に失敗しました", {
      authError,
      appError,
    });
    return [];
  }

  const provisionedIds = new Set((appUsers ?? []).map((user) => user.id));
  return authData.users
    .filter((user) => !provisionedIds.has(user.id))
    .map((user) => ({
      id: user.id,
      email: user.email ?? null,
      createdAt: user.created_at,
    }));
}
