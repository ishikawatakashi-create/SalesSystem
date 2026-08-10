import type { UserInvitationRow } from "@/types/database";

/** pending かつ未期限切れの招待か */
export function isActivePendingInvitation(
  inv: Pick<UserInvitationRow, "status" | "expires_at">,
  nowMs: number,
): boolean {
  if (inv.status !== "pending") return false;
  return new Date(String(inv.expires_at)).getTime() >= nowMs;
}

export function countActivePendingInvitations(
  invitations: Array<Pick<UserInvitationRow, "status" | "expires_at">>,
  nowMs: number,
): number {
  return invitations.filter((inv) => isActivePendingInvitation(inv, nowMs))
    .length;
}

/** archived_at がある履歴は管理画面から完全に除外する。 */
export function splitVisibleInvitations(
  invitations: UserInvitationRow[],
  nowMs: number,
): { active: UserInvitationRow[]; history: UserInvitationRow[] } {
  const visible = invitations.filter((inv) => inv.archived_at === null);
  return {
    active: visible.filter((inv) => isActivePendingInvitation(inv, nowMs)),
    history: visible.filter((inv) => !isActivePendingInvitation(inv, nowMs)),
  };
}
