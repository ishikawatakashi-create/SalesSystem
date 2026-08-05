import type { InvitationStatus, UserInvitationRow } from "@/types/database";

/**
 * 招待の状態遷移とバリデーション(純関数。単体テスト対象)。
 * 状態: pending(有効) / accepted(受諾済) / revoked(取消) / expired(期限切れ)
 *
 * 有効性判定はstatusとexpires_atの両方で行う
 * (期限切れジョブの実行遅延に依存しない。docs/supabase-schema.md §2)。
 */

/** 招待が現時点で利用可能(受諾できる)か */
export function isInvitationUsable(
  invitation: Pick<UserInvitationRow, "status" | "expires_at">,
  now: Date = new Date(),
): boolean {
  return (
    invitation.status === "pending" &&
    new Date(invitation.expires_at).getTime() >= now.getTime()
  );
}

/** 許可される状態遷移の定義 */
const ALLOWED_TRANSITIONS: Record<InvitationStatus, readonly InvitationStatus[]> = {
  pending: ["accepted", "revoked", "expired"],
  accepted: [],
  revoked: [],
  expired: [],
};

export function canTransition(
  from: InvitationStatus,
  to: InvitationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * 期限切れ処理(日次ジョブ)で expired へ更新すべきか。
 * pendingかつ期限超過のもののみが対象。
 */
export function shouldExpire(
  invitation: Pick<UserInvitationRow, "status" | "expires_at">,
  now: Date = new Date(),
): boolean {
  return (
    invitation.status === "pending" &&
    new Date(invitation.expires_at).getTime() < now.getTime()
  );
}
