import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcHandlers: new Map<
    string,
    (args: Record<string, unknown>) => Promise<{
      data: unknown;
      error: null | { message: string };
    }>
  >(),
  deletePendingInvitedAuthUser: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      mocks.rpcCalls.push({ name, args });
      return (
        (await mocks.rpcHandlers.get(name)?.(args)) ?? {
          data: null,
          error: null,
        }
      );
    },
  }),
}));

vi.mock("@/lib/auth/admin-api", () => ({
  deletePendingInvitedAuthUser: mocks.deletePendingInvitedAuthUser,
}));

import {
  archiveInvitationHistory,
  cancelPendingInvitation,
} from "@/lib/auth/invitation-admin-service";

const ADMIN = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "admin" as const,
  is_active: true,
};
const INVITATION_ID = "22222222-2222-4222-8222-222222222222";
const AUTH_USER_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  mocks.rpcCalls.length = 0;
  mocks.rpcHandlers.clear();
  mocks.deletePendingInvitedAuthUser.mockReset();
});

function prepareReady() {
  mocks.rpcHandlers.set("prepare_invitation_cancellation", async () => ({
    data: {
      state: "ready_for_auth_cleanup",
      auth_user_id: AUTH_USER_ID,
      normalized_email: "fixture@example.invalid",
    },
    error: null,
  }));
  mocks.rpcHandlers.set("record_invitation_auth_cleanup", async () => ({
    data: true,
    error: null,
  }));
}

describe("pending invitation cancellation", () => {
  it("cancels a pending invite, deletes only its pending Auth user, and records cleanup audit", async () => {
    prepareReady();
    mocks.deletePendingInvitedAuthUser.mockResolvedValue({
      ok: true,
      outcome: "deleted",
    });

    const result = await cancelPendingInvitation({
      actor: ADMIN,
      invitationId: INVITATION_ID,
    });

    expect(result).toEqual({ ok: true, message: "招待を取り消しました。" });
    expect(mocks.deletePendingInvitedAuthUser).toHaveBeenCalledWith({
      userId: AUTH_USER_ID,
      invitationId: INVITATION_ID,
      normalizedEmail: "fixture@example.invalid",
    });
    expect(mocks.rpcCalls).toContainEqual({
      name: "record_invitation_auth_cleanup",
      args: {
        p_actor_id: ADMIN.id,
        p_invitation_id: INVITATION_ID,
        p_cleanup_status: "deleted",
        p_detail: null,
      },
    });
  });

  it("does not touch Auth when the invitation was accepted", async () => {
    mocks.rpcHandlers.set("prepare_invitation_cancellation", async () => ({
      data: null,
      error: { message: "invitation_accepted" },
    }));

    const result = await cancelPendingInvitation({
      actor: ADMIN,
      invitationId: INVITATION_ID,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("既に受諾");
    expect(mocks.deletePendingInvitedAuthUser).not.toHaveBeenCalled();
  });

  it("does not touch a registered user when an app_users profile exists", async () => {
    mocks.rpcHandlers.set("prepare_invitation_cancellation", async () => ({
      data: null,
      error: { message: "invitation_profile_exists" },
    }));

    const result = await cancelPendingInvitation({
      actor: ADMIN,
      invitationId: INVITATION_ID,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("正式なユーザープロフィール");
    expect(mocks.deletePendingInvitedAuthUser).not.toHaveBeenCalled();
  });

  it("denies a non-admin before DB and Auth calls", async () => {
    const result = await cancelPendingInvitation({
      actor: { ...ADMIN, role: "a" },
      invitationId: INVITATION_ID,
    });

    expect(result).toEqual({ ok: false, message: "管理者権限が必要です" });
    expect(mocks.rpcCalls).toHaveLength(0);
    expect(mocks.deletePendingInvitedAuthUser).not.toHaveBeenCalled();
  });

  it("is idempotent when the invite is already cancelled", async () => {
    mocks.rpcHandlers.set("prepare_invitation_cancellation", async () => ({
      data: {
        state: "already_cancelled",
        auth_user_id: AUTH_USER_ID,
        normalized_email: "fixture@example.invalid",
      },
      error: null,
    }));

    const result = await cancelPendingInvitation({
      actor: ADMIN,
      invitationId: INVITATION_ID,
    });

    expect(result).toEqual({
      ok: true,
      message: "この招待は既に取り消されています。",
    });
    expect(mocks.deletePendingInvitedAuthUser).not.toHaveBeenCalled();
  });

  it("keeps Auth when its state changes after DB preparation", async () => {
    prepareReady();
    mocks.deletePendingInvitedAuthUser.mockResolvedValue({
      ok: false,
      code: "activated",
    });

    const result = await cancelPendingInvitation({
      actor: ADMIN,
      invitationId: INVITATION_ID,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Authユーザーは削除していません");
    expect(mocks.rpcCalls).toContainEqual({
      name: "record_invitation_auth_cleanup",
      args: expect.objectContaining({ p_cleanup_status: "skipped" }),
    });
  });
});

describe("invitation history archive", () => {
  it("archives invitation history without touching Auth", async () => {
    mocks.rpcHandlers.set("archive_invitation_history", async () => ({
      data: "archived",
      error: null,
    }));

    const result = await archiveInvitationHistory({
      actor: ADMIN,
      invitationId: INVITATION_ID,
    });

    expect(result).toEqual({ ok: true, message: "招待履歴を非表示にしました。" });
    expect(mocks.deletePendingInvitedAuthUser).not.toHaveBeenCalled();
    expect(mocks.rpcCalls).toContainEqual({
      name: "archive_invitation_history",
      args: {
        p_actor_id: ADMIN.id,
        p_invitation_id: INVITATION_ID,
      },
    });
  });
});
