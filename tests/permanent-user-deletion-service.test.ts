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
  deleteRegisteredInvitedAuthUser: vi.fn(),
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
  deleteRegisteredInvitedAuthUser: mocks.deleteRegisteredInvitedAuthUser,
}));

import {
  listPermanentDeleteEligibility,
  permanentlyDeleteInvitedUser,
} from "@/lib/auth/permanent-user-deletion-service";

const ADMIN = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "admin" as const,
  is_active: true,
};
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  mocks.rpcCalls.length = 0;
  mocks.rpcHandlers.clear();
  mocks.deleteRegisteredInvitedAuthUser.mockReset();
});

function prepareReady(): void {
  mocks.rpcHandlers.set("prepare_user_permanent_deletion", async () => ({
    data: {
      state: "ready_for_auth_cleanup",
      auth_user_id: TARGET_ID,
      normalized_email: "fixture@example.invalid",
      invitation_id: INVITATION_ID,
    },
    error: null,
  }));
  mocks.rpcHandlers.set("finalize_user_permanent_deletion", async () => ({
    data: "completed",
    error: null,
  }));
}

describe("accepted invited user permanent deletion", () => {
  it("deletes an eligible accepted user, Auth identity, and finalizes the retained invitation", async () => {
    prepareReady();
    mocks.deleteRegisteredInvitedAuthUser.mockResolvedValue({
      ok: true,
      outcome: "deleted",
    });

    const result = await permanentlyDeleteInvitedUser({
      actor: ADMIN,
      targetUserId: TARGET_ID,
      reason: "re-register",
    });

    expect(result.ok).toBe(true);
    expect(mocks.deleteRegisteredInvitedAuthUser).toHaveBeenCalledWith({
      userId: TARGET_ID,
      invitationId: INVITATION_ID,
      normalizedEmail: "fixture@example.invalid",
    });
    expect(mocks.rpcCalls).toContainEqual({
      name: "finalize_user_permanent_deletion",
      args: {
        p_actor_id: ADMIN.id,
        p_target_user_id: TARGET_ID,
        p_auth_outcome: "deleted",
      },
    });
  });

  it("rejects a user with any business reference before Auth deletion", async () => {
    mocks.rpcHandlers.set("prepare_user_permanent_deletion", async () => ({
      data: null,
      error: { message: "business_references" },
    }));

    const result = await permanentlyDeleteInvitedUser({
      actor: ADMIN,
      targetUserId: TARGET_ID,
      reason: "test",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("業務履歴");
    expect(mocks.deleteRegisteredInvitedAuthUser).not.toHaveBeenCalled();
  });

  it("restores app_users and invitation when Auth hard delete fails", async () => {
    prepareReady();
    mocks.deleteRegisteredInvitedAuthUser.mockResolvedValue({
      ok: false,
      code: "auth_error",
    });
    mocks.rpcHandlers.set(
      "restore_user_after_permanent_delete_failure",
      async () => ({ data: "restored", error: null }),
    );

    const result = await permanentlyDeleteInvitedUser({
      actor: ADMIN,
      targetUserId: TARGET_ID,
      reason: "mistaken_invitation",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("復元しました");
    expect(mocks.rpcCalls).toContainEqual({
      name: "restore_user_after_permanent_delete_failure",
      args: {
        p_actor_id: ADMIN.id,
        p_target_user_id: TARGET_ID,
        p_detail: "auth_error",
      },
    });
  });

  it("is idempotent after a completed deletion", async () => {
    mocks.rpcHandlers.set("prepare_user_permanent_deletion", async () => ({
      data: { state: "already_deleted" },
      error: null,
    }));

    const result = await permanentlyDeleteInvitedUser({
      actor: ADMIN,
      targetUserId: TARGET_ID,
      reason: "test",
    });

    expect(result).toEqual({
      ok: true,
      message: "このユーザーは既に完全削除されています。",
    });
    expect(mocks.deleteRegisteredInvitedAuthUser).not.toHaveBeenCalled();
  });

  it("denies a non-admin before DB and Auth calls", async () => {
    const result = await permanentlyDeleteInvitedUser({
      actor: { ...ADMIN, role: "a" },
      targetUserId: TARGET_ID,
      reason: "test",
    });

    expect(result).toEqual({ ok: false, message: "管理者権限が必要です" });
    expect(mocks.rpcCalls).toHaveLength(0);
    expect(mocks.deleteRegisteredInvitedAuthUser).not.toHaveBeenCalled();
  });
});

describe("permanent deletion eligibility DTO", () => {
  it("returns only target id, eligible, and reason to the client-facing page", async () => {
    mocks.rpcHandlers.set("list_user_permanent_delete_eligibility", async () => ({
      data: [
        {
          target_user_id: TARGET_ID,
          eligible: false,
          reason_code: "storage_owned",
          reference_counts: { storage_objects: 1 },
        },
      ],
      error: null,
    }));

    const result = await listPermanentDeleteEligibility({ actor: ADMIN });

    expect(result.get(TARGET_ID)).toEqual({
      eligible: false,
      reasonCode: "storage_owned",
    });
  });
});
