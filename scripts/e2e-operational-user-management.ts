import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[match[1]!] && value) process.env[match[1]!] = value;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const email = required("USER_MGMT_E2E_EMAIL").trim().toLowerCase();
  const initialPassword = required("USER_MGMT_E2E_INITIAL_PASSWORD");
  const newPassword = required("USER_MGMT_E2E_NEW_PASSWORD");
  if (!/^test_phase_user_management_[a-z0-9_-]+@example\.invalid$/.test(email)) {
    throw new Error("fixture email must match test_phase_user_management_*@example.invalid");
  }
  if (initialPassword === newPassword) throw new Error("passwords must differ");

  const {
    changeUserRole,
    getUserDisableImpact,
    provisionUserDirectly,
    resetUserPasswordByAdmin,
    setUserActiveState,
  } = await import("../src/lib/auth/admin-user-service");
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: admins, error: adminError } = await admin
    .from("app_users")
    .select("id,role,is_active,display_name")
    .eq("role", "admin")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (adminError || !admins?.length) throw new Error("active admin missing");
  const actor = admins[0]!;

  let { data: fixture } = await admin
    .from("app_users")
    .select("id,email,display_name,role,is_active")
    .ilike("email", email)
    .maybeSingle();
  if (!fixture) {
    const created = await provisionUserDirectly({
      actor,
      requestId: crypto.randomUUID(),
      displayName: "ユーザー管理E2E",
      email,
      password: initialPassword,
      role: "b",
    });
    if (!created.ok) throw new Error(`direct create failed: ${created.code}`);
    const read = await admin
      .from("app_users")
      .select("id,email,display_name,role,is_active")
      .eq("id", created.userId)
      .single();
    if (read.error || !read.data) throw new Error("created profile missing");
    fixture = read.data;
  }
  if (!fixture.is_active) {
    const reenabled = await setUserActiveState({
      actor,
      targetUserId: fixture.id,
      active: true,
    });
    if (!reenabled.ok) throw new Error(`initial re-enable failed: ${reenabled.code}`);
  }

  const publicClient = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const loginInitial = await publicClient.auth.signInWithPassword({
    email,
    password: initialPassword,
  });
  if (loginInitial.error) throw new Error("initial login failed");
  await publicClient.auth.signOut();

  const roleChanged = await changeUserRole({
    actor,
    targetUserId: fixture.id,
    role: "a",
  });
  if (!roleChanged.ok) throw new Error(`role change failed: ${roleChanged.code}`);
  const roleRestored = await changeUserRole({
    actor,
    targetUserId: fixture.id,
    role: "b",
  });
  if (!roleRestored.ok) throw new Error(`role restore failed: ${roleRestored.code}`);

  const reset = await resetUserPasswordByAdmin({
    actor,
    targetUserId: fixture.id,
    password: newPassword,
  });
  if (!reset.ok) throw new Error(`password reset failed: ${reset.code}`);
  const oldLogin = await publicClient.auth.signInWithPassword({
    email,
    password: initialPassword,
  });
  if (!oldLogin.error) throw new Error("old password still works");
  const newLogin = await publicClient.auth.signInWithPassword({
    email,
    password: newPassword,
  });
  if (newLogin.error) throw new Error("new password login failed");
  await publicClient.auth.signOut();

  const impact = await getUserDisableImpact({ actor, targetUserId: fixture.id });
  if (!impact.ok) throw new Error(`impact check failed: ${impact.code}`);
  if (Object.values(impact.impact).some((count) => count !== 0)) {
    throw new Error("fixture unexpectedly owns production data");
  }

  const disabled = await setUserActiveState({
    actor,
    targetUserId: fixture.id,
    active: false,
  });
  if (!disabled.ok) throw new Error(`disable failed: ${disabled.code}`);
  const disabledLogin = await publicClient.auth.signInWithPassword({
    email,
    password: newPassword,
  });
  if (!disabledLogin.error) throw new Error("disabled login unexpectedly succeeded");
  const { count: activeChoiceCount } = await admin
    .from("app_users")
    .select("id", { count: "exact", head: true })
    .eq("id", fixture.id)
    .eq("is_active", true);
  if ((activeChoiceCount ?? 0) !== 0) throw new Error("disabled user remains active choice");

  const reenabled = await setUserActiveState({
    actor,
    targetUserId: fixture.id,
    active: true,
  });
  if (!reenabled.ok) throw new Error(`re-enable failed: ${reenabled.code}`);
  const reenabledLogin = await publicClient.auth.signInWithPassword({
    email,
    password: newPassword,
  });
  if (reenabledLogin.error) throw new Error("re-enabled login failed");
  await publicClient.auth.signOut();

  const { data: audits, error: auditError } = await admin
    .from("audit_logs")
    .select("action,changed_fields")
    .contains("changed_fields", { target_user_id: fixture.id })
    .in("action", [
      "user.direct_create",
      "user.role_assign",
      "user.role_change",
      "user.password_reset_by_admin",
      "user.disable",
      "user.reenable",
    ]);
  if (auditError) throw new Error("audit read failed");
  const actions = new Set((audits ?? []).map((row) => row.action));
  for (const action of [
    "user.direct_create",
    "user.role_assign",
    "user.role_change",
    "user.password_reset_by_admin",
    "user.disable",
    "user.reenable",
  ]) {
    if (!actions.has(action)) throw new Error(`audit action missing: ${action}`);
  }
  const auditJson = JSON.stringify(audits ?? []);
  if (auditJson.includes(initialPassword) || auditJson.includes(newPassword)) {
    throw new Error("password leaked to audit");
  }

  const finalDisable = await setUserActiveState({
    actor,
    targetUserId: fixture.id,
    active: false,
  });
  if (!finalDisable.ok) throw new Error(`final disable failed: ${finalDisable.code}`);

  console.log(
    JSON.stringify({
      fixture: "disabled",
      direct_create: true,
      initial_login: true,
      role_change: true,
      password_reset: true,
      disable_login_rejected: true,
      reenable_login: true,
      assignee_active_filter: true,
      audit: true,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2e failed");
  process.exit(1);
});
