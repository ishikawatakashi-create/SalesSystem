import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  deleteUser: vi.fn(),
  inviteUserByEmail: vi.fn(),
  queryResults: [] as Array<{
    data: unknown;
    error: null | { message: string };
  }>,
  auditInsert: vi.fn(),
}));

function queryBuilder() {
  const builder = {
    select: () => builder,
    update: () => builder,
    eq: () => builder,
    is: () => builder,
    maybeSingle: () =>
      Promise.resolve(
        mocks.queryResults.shift() ?? { data: null, error: null },
      ),
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        getUserById: mocks.getUserById,
        deleteUser: mocks.deleteUser,
        inviteUserByEmail: mocks.inviteUserByEmail,
      },
    },
    from: (table: string) =>
      table === "audit_logs"
        ? { insert: mocks.auditInsert }
        : queryBuilder(),
  }),
}));

vi.mock("@/lib/env", () => ({
  inviteRedirectUrl: () => "https://sales-system-weld.vercel.app/auth/invite",
}));

import {
  deletePendingInvitedAuthUser,
  inviteUserByEmailSafe,
} from "@/lib/auth/admin-api";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const INVITATION_ID = "22222222-2222-4222-8222-222222222222";

function pendingUser(patch: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "fixture@example.invalid",
    invited_at: "2026-08-10T00:00:00Z",
    email_confirmed_at: null,
    confirmed_at: null,
    last_sign_in_at: null,
    user_metadata: { invitation_id: INVITATION_ID },
    ...patch,
  };
}

beforeEach(() => {
  mocks.getUserById.mockReset();
  mocks.deleteUser.mockReset();
  mocks.inviteUserByEmail.mockReset();
  mocks.queryResults.length = 0;
  mocks.auditInsert.mockReset();
  mocks.auditInsert.mockResolvedValue({ data: null, error: null });
});

describe("invite Auth mapping", () => {
  it("stores invitation metadata, canonical redirect, and Auth user id", async () => {
    mocks.queryResults.push(
      {
        data: {
          id: INVITATION_ID,
          normalized_email: "fixture@example.invalid",
          status: "pending",
          expires_at: "2099-08-10T00:00:00Z",
          role: "viewer",
        },
        error: null,
      },
      { data: { id: INVITATION_ID }, error: null },
    );
    mocks.inviteUserByEmail.mockResolvedValue({
      data: { user: pendingUser() },
      error: null,
    });

    const result = await inviteUserByEmailSafe({
      actor: {
        id: "11111111-1111-4111-8111-111111111111",
        role: "admin",
        is_active: true,
      },
      email: "fixture@example.invalid",
      displayName: "fixture",
      role: "viewer",
      invitationId: INVITATION_ID,
    });

    expect(result).toEqual({ ok: true, userId: USER_ID });
    expect(mocks.inviteUserByEmail).toHaveBeenCalledWith(
      "fixture@example.invalid",
      {
        data: {
          display_name: "fixture",
          invitation_id: INVITATION_ID,
          invitation_source: "sales_system",
        },
        redirectTo: "https://sales-system-weld.vercel.app/auth/invite",
      },
    );
    expect(mocks.auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.invite",
        changed_fields: expect.objectContaining({ auth_user_id: USER_ID }),
      }),
    );
  });
});

describe("pending invited Auth user cleanup", () => {
  it("deletes only a matching, unconfirmed, never-signed-in invite user", async () => {
    mocks.getUserById.mockResolvedValue({
      data: { user: pendingUser() },
      error: null,
    });
    mocks.deleteUser.mockResolvedValue({ data: {}, error: null });

    const result = await deletePendingInvitedAuthUser({
      userId: USER_ID,
      invitationId: INVITATION_ID,
      normalizedEmail: "fixture@example.invalid",
    });

    expect(result).toEqual({ ok: true, outcome: "deleted" });
    expect(mocks.deleteUser).toHaveBeenCalledWith(USER_ID);
  });

  it("refuses deletion after confirmation or login", async () => {
    mocks.getUserById.mockResolvedValue({
      data: {
        user: pendingUser({
          email_confirmed_at: "2026-08-10T01:00:00Z",
          last_sign_in_at: "2026-08-10T01:01:00Z",
        }),
      },
      error: null,
    });

    const result = await deletePendingInvitedAuthUser({
      userId: USER_ID,
      invitationId: INVITATION_ID,
      normalizedEmail: "fixture@example.invalid",
    });

    expect(result).toEqual({ ok: false, code: "activated" });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("refuses deletion when the invite mapping is ambiguous", async () => {
    mocks.getUserById.mockResolvedValue({
      data: { user: pendingUser({ user_metadata: {} }) },
      error: null,
    });

    const result = await deletePendingInvitedAuthUser({
      userId: USER_ID,
      invitationId: INVITATION_ID,
      normalizedEmail: "fixture@example.invalid",
    });

    expect(result).toEqual({ ok: false, code: "mapping_mismatch" });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("treats an already-missing Auth user as an idempotent success", async () => {
    mocks.getUserById.mockResolvedValue({
      data: { user: null },
      error: { code: "user_not_found", message: "User not found" },
    });

    const result = await deletePendingInvitedAuthUser({
      userId: USER_ID,
      invitationId: INVITATION_ID,
      normalizedEmail: "fixture@example.invalid",
    });

    expect(result).toEqual({ ok: true, outcome: "not_found" });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
