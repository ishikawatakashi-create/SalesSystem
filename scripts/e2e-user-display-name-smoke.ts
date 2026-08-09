/**
 * Production smoke: display_name rename / role labels / fixture grouping.
 * 本物の他ユーザー名は変更しない。admin 自身は一時変更→即復元。
 *
 * Usage:
 *   $env:NODE_OPTIONS='--require ./scripts/shims/mock-server-only.cjs'
 *   npx tsx scripts/e2e-user-display-name-smoke.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  isFixtureUserAccount,
  validateDisplayName,
} from "../src/lib/auth/display-name";
import { APP_ROLE_LABELS, getAppRoleLabel } from "../src/lib/auth/role-labels";
import { updateUserDisplayName } from "../src/lib/auth/update-display-name";
import { buildInquiryReplyDraftBody } from "../src/lib/inquiries/reply-template";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnvLocal();

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function ok(label: string) {
  console.log(`OK  ${label}`);
}
function fail(label: string, detail?: string): never {
  console.error(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  process.exit(1);
}

async function main() {
  if (getAppRoleLabel("admin") !== "管理者") fail("role_admin");
  if (getAppRoleLabel("a") !== "運用責任者") fail("role_a");
  if (getAppRoleLabel("b") !== "担当者") fail("role_b");
  if (getAppRoleLabel("viewer") !== "閲覧者") fail("role_viewer");
  if (Object.keys(APP_ROLE_LABELS).sort().join(",") !== "a,admin,b,viewer") {
    fail("role_keys");
  }
  ok("role_labels");

  if (validateDisplayName("   ").ok) fail("validate_ws");
  if (!validateDisplayName("石川").ok) fail("validate_ok");
  ok("validation");

  const url = req("NEXT_PUBLIC_SUPABASE_URL");
  const key = req("SUPABASE_SECRET_KEY");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: users, error } = await admin
    .from("app_users")
    .select("id,email,display_name,role,is_active")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) fail("list_users", error.message);
  const rows = users ?? [];

  const fixtures = rows.filter((u) => isFixtureUserAccount(u));
  const production = rows.filter((u) => !isFixtureUserAccount(u));
  if (production.length === 0) fail("no_production_users");
  ok(
    `fixture_split production=${production.length} fixtures=${fixtures.length}`,
  );

  const adminUser = production.find((u) => u.role === "admin" && u.is_active);
  if (!adminUser) fail("no_admin");

  const originalName = String(adminUser.display_name);
  const marker = `__smoke_${Date.now().toString(36)}`;
  const tempName = `${originalName} ${marker}`.slice(0, 100);

  const renameSelf = await updateUserDisplayName({
    actor: {
      id: adminUser.id,
      role: "admin",
      display_name: originalName,
    },
    targetUserId: adminUser.id,
    displayName: tempName,
  });
  if (!renameSelf.ok) fail("admin_rename_self", renameSelf.message);
  ok("admin_rename_self");

  const { data: after } = await admin
    .from("app_users")
    .select("display_name")
    .eq("id", adminUser.id)
    .single();
  if (String(after?.display_name) !== tempName) fail("persist_after_rename");
  ok("persist_reload");

  const body = buildInquiryReplyDraftBody({
    companyName: "テスト株式会社",
    senderName: "山田",
    actorDisplayName: String(after?.display_name),
    messageText: "smoke",
  });
  if (!body.includes(`株式会社イルの${tempName}です`)) {
    fail("gmail_template", body.slice(0, 120));
  }
  ok("gmail_template");

  const restore = await updateUserDisplayName({
    actor: {
      id: adminUser.id,
      role: "admin",
      display_name: tempName,
    },
    targetUserId: adminUser.id,
    displayName: originalName,
  });
  if (!restore.ok) fail("admin_restore", restore.message);
  ok("admin_restore");

  const fixtureActor =
    fixtures.find((u) => u.role === "b" && u.is_active) ??
    fixtures.find((u) => u.role !== "admin" && u.is_active);
  if (fixtureActor) {
    const denied = await updateUserDisplayName({
      actor: {
        id: fixtureActor.id,
        role: fixtureActor.role as "a" | "b" | "viewer",
        display_name: String(fixtureActor.display_name),
      },
      targetUserId: adminUser.id,
      displayName: "乗っ取り禁止",
    });
    if (denied.ok) fail("non_admin_rename_other_should_deny");
    ok("non_admin_cannot_rename_other");

    const selfOk = await updateUserDisplayName({
      actor: {
        id: fixtureActor.id,
        role: fixtureActor.role as "a" | "b" | "viewer",
        display_name: String(fixtureActor.display_name),
      },
      targetUserId: fixtureActor.id,
      displayName: String(fixtureActor.display_name),
    });
    if (!selfOk.ok) fail("fixture_rename_self_noop", selfOk.message);
    ok("non_admin_can_rename_self_noop");
  } else {
    ok("skip_non_admin_acl (no fixture actor)");
  }

  const { data: audits } = await admin
    .from("audit_logs")
    .select("action,changed_fields,created_at")
    .eq("action", "user.display_name_change")
    .order("created_at", { ascending: false })
    .limit(5);
  const hit = (audits ?? []).some((a) => {
    const cf = a.changed_fields as Record<string, string>;
    return (
      cf?.target_user_id === adminUser.id &&
      (cf?.new_display_name === tempName || cf?.old_display_name === tempName)
    );
  });
  if (!hit) fail("audit_missing");
  ok("audit_rename");

  // HTTP: production page shows Japanese role labels (public login only check optional)
  const base =
    process.env.PRODUCTION_BASE_URL?.replace(/\/$/, "") ||
    "https://sales-system-weld.vercel.app";
  const profileRes = await fetch(`${base}/settings/profile`);
  // unauthenticated should redirect to login
  if (profileRes.status >= 500) fail("profile_route_5xx", String(profileRes.status));
  ok(`profile_route_reachable status=${profileRes.status}`);

  console.log("\nAll user-display-name Production smoke checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
