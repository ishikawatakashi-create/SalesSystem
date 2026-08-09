import type { AppRole } from "@/types/database";

/**
 * UI 表示用ロール名称。内部 role code (admin/a/b/viewer) は変更しない。
 */
export const APP_ROLE_LABELS: Record<AppRole, string> = {
  admin: "管理者",
  a: "運用責任者",
  b: "担当者",
  viewer: "閲覧者",
};

export const APP_ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: "システム全体の設定・ユーザー管理が可能",
  a: "営業リスト管理・担当割当などの運用設定と日常業務が可能",
  b: "顧客対応・営業活動・記録などの日常業務が可能",
  viewer: "登録情報の閲覧が可能",
};

export const APP_ROLE_OPTIONS: ReadonlyArray<{
  value: AppRole;
  label: string;
  description: string;
}> = (
  ["admin", "a", "b", "viewer"] as const
).map((value) => ({
  value,
  label: APP_ROLE_LABELS[value],
  description: APP_ROLE_DESCRIPTIONS[value],
}));

export function getAppRoleLabel(role: AppRole | string | null | undefined): string {
  if (!role) return "—";
  if (role in APP_ROLE_LABELS) {
    return APP_ROLE_LABELS[role as AppRole];
  }
  return String(role);
}

export function getAppRoleDescription(
  role: AppRole | string | null | undefined,
): string {
  if (!role) return "";
  if (role in APP_ROLE_DESCRIPTIONS) {
    return APP_ROLE_DESCRIPTIONS[role as AppRole];
  }
  return "";
}
