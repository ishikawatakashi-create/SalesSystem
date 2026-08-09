import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcHandlers: new Map<
    string,
    (args: Record<string, unknown>) => Promise<{ data: unknown; error: null | { message: string } }>
  >(),
  fromResults: [] as Array<{ data: unknown; error: null | { message: string }; count?: number | null }>,
  createDirectAuthUser: vi.fn(),
  deleteIncompleteAuthUser: vi.fn(),
  setAuthUserDisabled: vi.fn(),
  resetAuthUserPassword: vi.fn(),
}));

function query(result: { data: unknown; error: null | { message: string }; count?: number | null }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    ilike: () => builder,
    in: () => builder,
    contains: () => builder,
    is: () => builder,
    maybeSingle: () => builder,
    then: (resolveResult: (value: typeof result) => unknown) =>
      Promise.resolve(resolveResult(result)),
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      mocks.rpcCalls.push({ name, args });
      return (
        (await mocks.rpcHandlers.get(name)?.(args)) ?? { data: null, error: null }
      );
    },
    from: () => query(mocks.fromResults.shift() ?? { data: null, error: null }),
  }),
}));

vi.mock("@/lib/auth/admin-api", () => ({
  createDirectAuthUser: mocks.createDirectAuthUser,
  deleteIncompleteAuthUser: mocks.deleteIncompleteAuthUser,
  setAuthUserDisabled: mocks.setAuthUserDisabled,
  resetAuthUserPassword: mocks.resetAuthUserPassword,
}));

import {
  AUTH_PASSWORD_MIN_LENGTH,
  changeUserRole,
  provisionUserDirectly,
  resetUserPasswordByAdmin,
  setUserActiveState,
} from "@/lib/auth/admin-user-service";

const ADMIN = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "admin" as const,
  is_active: true,
  display_name: "管理者",
};
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  mocks.rpcCalls.length = 0;
  mocks.rpcHandlers.clear();
  mocks.fromResults.length = 0;
  mocks.createDirectAuthUser.mockReset();
  mocks.deleteIncompleteAuthUser.mockReset();
  mocks.setAuthUserDisabled.mockReset();
  mocks.resetAuthUserPassword.mockReset();
});

describe("admin direct user provisioning", () => {
  it.each(["admin", "a", "b", "viewer"] as const)(
    "creates Auth + app_users with role=%s without putting password in RPC",
    async (role) => {
      mocks.rpcHandlers.set("begin_direct_user_provisioning", async () => ({
        data: "started",
        error: null,
      }));
      mocks.rpcHandlers.set("complete_direct_user_provisioning", async () => ({
        data: { id: TARGET_ID },
        error: null,
      }));
      mocks.createDirectAuthUser.mockResolvedValue({ ok: true, userId: TARGET_ID });

      const result = await provisionUserDirectly({
        actor: ADMIN,
        requestId: REQUEST_ID,
        displayName: " 山田 太郎 ",
        email: "YAMADA@Example.com ",
        password: "secret12",
        role,
      });

      expect(result.ok).toBe(true);
      expect(mocks.createDirectAuthUser).toHaveBeenCalledWith({
        email: "yamada@example.com",
        password: "secret12",
        displayName: "山田 太郎",
      });
      const completed = mocks.rpcCalls.find(
        (call) => call.name === "complete_direct_user_provisioning",
      );
      expect(completed?.args.p_role).toBe(role);
      expect(JSON.stringify(completed?.args)).not.toContain("secret12");
      expect(JSON.stringify(completed?.args)).not.toContain("password");
    },
  );

  it("rejects a non-admin before touching Auth or DB", async () => {
    const result = await provisionUserDirectly({
      actor: { ...ADMIN, role: "a" },
      requestId: REQUEST_ID,
      displayName: "担当",
      email: "user@example.invalid",
      password: "secret12",
      role: "b",
    });
    expect(result.ok).toBe(false);
    expect(mocks.rpcCalls).toHaveLength(0);
    expect(mocks.createDirectAuthUser).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid email", { email: "not-mail" }],
    ["weak password", { password: "12345" }],
    ["invalid role", { role: "owner" }],
  ])("rejects %s", async (_label, patch) => {
    const result = await provisionUserDirectly({
      actor: ADMIN,
      requestId: REQUEST_ID,
      displayName: "担当",
      email: "user@example.invalid",
      password: "secret12",
      role: "b",
      ...patch,
    } as never);
    expect(result.ok).toBe(false);
    expect(mocks.createDirectAuthUser).not.toHaveBeenCalled();
  });

  it("returns the duplicate Japanese message without creating Auth", async () => {
    mocks.rpcHandlers.set("begin_direct_user_provisioning", async () => ({
      data: null,
      error: { message: "email_registered" },
    }));
    mocks.fromResults.push({ data: { is_active: true }, error: null });
    const result = await provisionUserDirectly({
      actor: ADMIN,
      requestId: REQUEST_ID,
      displayName: "担当",
      email: "user@example.invalid",
      password: "secret12",
      role: "b",
    });
    expect(result).toMatchObject({
      ok: false,
      message: "このメールアドレスは既に登録されています",
    });
    expect(mocks.createDirectAuthUser).not.toHaveBeenCalled();
  });

  it("does not create twice while the same request is processing", async () => {
    mocks.rpcHandlers.set("begin_direct_user_provisioning", async () => ({
      data: "processing",
      error: null,
    }));
    const result = await provisionUserDirectly({
      actor: ADMIN,
      requestId: REQUEST_ID,
      displayName: "担当",
      email: "user@example.invalid",
      password: "secret12",
      role: "b",
    });
    expect(result).toMatchObject({ ok: false, code: "processing" });
    expect(mocks.createDirectAuthUser).not.toHaveBeenCalled();
  });

  it("compensates Auth creation when app_users creation fails", async () => {
    mocks.rpcHandlers.set("begin_direct_user_provisioning", async () => ({ data: "started", error: null }));
    mocks.rpcHandlers.set("complete_direct_user_provisioning", async () => ({
      data: null,
      error: { message: "profile insert failed" },
    }));
    mocks.rpcHandlers.set("fail_direct_user_provisioning", async () => ({ data: true, error: null }));
    mocks.fromResults.push({ data: null, error: null });
    mocks.createDirectAuthUser.mockResolvedValue({ ok: true, userId: TARGET_ID });
    mocks.deleteIncompleteAuthUser.mockResolvedValue({ ok: true });

    const result = await provisionUserDirectly({
      actor: ADMIN,
      requestId: REQUEST_ID,
      displayName: "担当",
      email: "user@example.invalid",
      password: "secret12",
      role: "b",
    });
    expect(result.ok).toBe(false);
    expect(mocks.deleteIncompleteAuthUser).toHaveBeenCalledWith(TARGET_ID);
  });
});

describe("user lifecycle security", () => {
  it("rejects self-disable without Auth mutation", async () => {
    const result = await setUserActiveState({
      actor: ADMIN,
      targetUserId: ADMIN.id,
      active: false,
    });
    expect(result).toMatchObject({ ok: false, code: "self_disable" });
    expect(mocks.setAuthUserDisabled).not.toHaveBeenCalled();
  });

  it("rejects last-admin disable before Auth mutation", async () => {
    mocks.fromResults.push(
      { data: { id: TARGET_ID, role: "admin", is_active: true }, error: null },
      { data: null, error: null, count: 1 },
    );
    const result = await setUserActiveState({
      actor: ADMIN,
      targetUserId: TARGET_ID,
      active: false,
    });
    expect(result).toMatchObject({ ok: false, code: "last_admin" });
    expect(mocks.setAuthUserDisabled).not.toHaveBeenCalled();
  });

  it("disables Auth and app profile through the guarded RPC", async () => {
    mocks.fromResults.push({
      data: { id: TARGET_ID, role: "b", is_active: true },
      error: null,
    });
    mocks.setAuthUserDisabled.mockResolvedValue({ ok: true, previouslyBanned: false });
    mocks.rpcHandlers.set("set_app_user_active", async () => ({ data: {}, error: null }));
    const result = await setUserActiveState({
      actor: ADMIN,
      targetUserId: TARGET_ID,
      active: false,
    });
    expect(result.ok).toBe(true);
    expect(mocks.setAuthUserDisabled).toHaveBeenCalledWith({
      userId: TARGET_ID,
      disabled: true,
    });
  });

  it("rejects self-demotion", async () => {
    const result = await changeUserRole({
      actor: ADMIN,
      targetUserId: ADMIN.id,
      role: "b",
    });
    expect(result).toMatchObject({ ok: false, code: "self_demote" });
    expect(mocks.rpcCalls).toHaveLength(0);
  });

  it("resets password and audits only the target id", async () => {
    mocks.fromResults.push({ data: { id: TARGET_ID }, error: null });
    mocks.resetAuthUserPassword.mockResolvedValue({ ok: true });
    mocks.rpcHandlers.set("record_admin_password_reset", async () => ({ data: true, error: null }));
    const result = await resetUserPasswordByAdmin({
      actor: ADMIN,
      targetUserId: TARGET_ID,
      password: "new-secret12",
    });
    expect(result.ok).toBe(true);
    const audit = mocks.rpcCalls.find((call) => call.name === "record_admin_password_reset");
    expect(audit?.args).toEqual({
      p_actor_id: ADMIN.id,
      p_target_user_id: TARGET_ID,
    });
    expect(JSON.stringify(audit?.args)).not.toContain("new-secret12");
  });
});

describe("migration and secret handling", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260809030000_operational_user_management.sql"),
    "utf8",
  );
  const service = readFileSync(
    resolve(process.cwd(), "src/lib/auth/admin-user-service.ts"),
    "utf8",
  );

  it("uses the configured Supabase-compatible minimum password length", () => {
    expect(AUTH_PASSWORD_MIN_LENGTH).toBe(6);
  });

  it("has DB-enforced admin, self-disable, and last-admin guards", () => {
    expect(migration).toContain("role = 'admin'");
    expect(migration).toContain("message = 'self_disable'");
    expect(migration).toContain("message = 'self_demote'");
    expect(migration).toContain("message = 'last_admin'");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("reserves direct create requests and compensates partial failure", () => {
    expect(migration).toContain("user_admin_operations_processing_email_uniq");
    expect(migration).toContain("begin_direct_user_provisioning");
    expect(migration).toContain("complete_direct_user_provisioning");
    expect(service).toContain("deleteIncompleteAuthUser");
  });

  it("never places a password in user audit changed_fields", () => {
    const auditSections = migration.match(/insert into public\.audit_logs[\s\S]*?;/g) ?? [];
    expect(auditSections.length).toBeGreaterThanOrEqual(4);
    for (const section of auditSections) {
      expect(section.toLowerCase()).not.toMatch(/['\"](?:new_|old_)?password['\"]/);
    }
    expect(migration).toContain(
      "pg_catalog.jsonb_build_object('target_user_id', p_target_user_id)",
    );
  });
});
