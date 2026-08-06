import type { ProvisioningStatus } from "@/types/database";

/**
 * 認証技術スパイク中にアプリ利用を許可する状態。
 *
 * profile_created:
 *   Authとapp_usersの作成が完了。Notion自社担当者ページは未作成。
 * completed:
 *   Notion接続後、自社担当者ページ作成まで完了した最終状態。
 *
 * Notion接続実装時はprofile_createdをuser_provisioningジョブの対象にし、
 * notion_staff_page_id保存と同時にcompletedへ遷移する。
 */
export function isUsableProvisioningStatus(
  status: ProvisioningStatus,
): boolean {
  return status === "profile_created" || status === "completed";
}
