import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260806000001_auth_spike_corrections.sql",
  ),
  "utf8",
);

describe("Before User Created Hookマイグレーション", () => {
  it("公式payloadのevent.user.emailだけを参照する", () => {
    expect(migration).toContain("event #>> '{user,email}'");
    expect(migration).not.toContain("record,email");
    expect(migration).not.toContain("claims,email");
  });

  it("pendingかつ期限内の招待だけを許可し、成功時は空JSONを返す", () => {
    expect(migration).toContain("status = 'pending'");
    expect(migration).toContain("expires_at >= pg_catalog.now()");
    expect(migration).toContain("return '{}'::jsonb");
  });

  it("HookのEXECUTEをsupabase_auth_adminだけに許可する", () => {
    expect(migration).toMatch(
      /revoke execute on function public\.hook_before_user_created\(jsonb\)[\s\S]*from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.hook_before_user_created\(jsonb\)[\s\S]*to supabase_auth_admin;/,
    );
  });

  it("SECURITY DEFINERと空search_path、スキーマ修飾を使用する", () => {
    expect(migration).toContain("security definer set search_path = ''");
    expect(migration).toContain("from public.user_invitations");
  });
});
