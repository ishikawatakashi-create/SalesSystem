/**
 * masters_cache / app_users / customer_index のリモート実測。
 * 個人情報(メール・氏名)は出力しない。
 *
 * Usage: npx tsx scripts/check-masters-cache.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: masters, error: mErr } = await supabase
    .from("masters_cache")
    .select(
      "notion_page_id,master_type,name,semantic_key,semantic_tags,is_active,sync_status",
    );
  if (mErr) throw new Error(`masters_cache: ${mErr.message}`);
  const rows = masters ?? [];
  console.log(`masters_cache total: ${rows.length}`);
  const byType = new Map<string, number>();
  for (const r of rows as { master_type: string }[]) {
    byType.set(r.master_type, (byType.get(r.master_type) ?? 0) + 1);
  }
  for (const [t, n] of [...byType.entries()].sort()) {
    console.log(`  ${t}: ${n}`);
  }
  const typed = rows as {
    is_active: boolean;
    notion_page_id: string | null;
    semantic_key: string | null;
    semantic_tags: string[] | null;
    sync_status: string;
  }[];
  console.log(`  inactive: ${typed.filter((r) => !r.is_active).length}`);
  console.log(
    `  missing notion_page_id: ${typed.filter((r) => !r.notion_page_id).length}`,
  );
  console.log(
    `  with semantic_key: ${typed.filter((r) => r.semantic_key).length}`,
  );
  console.log(
    `  with semantic_tags: ${typed.filter((r) => (r.semantic_tags ?? []).length > 0).length}`,
  );
  const statusCount = new Map<string, number>();
  for (const r of typed) {
    statusCount.set(r.sync_status, (statusCount.get(r.sync_status) ?? 0) + 1);
  }
  console.log(`  sync_status: ${JSON.stringify([...statusCount.entries()])}`);

  const { data: users, error: uErr } = await supabase
    .from("app_users")
    .select("role,is_active,notion_staff_page_id,provisioning_status");
  if (uErr) throw new Error(`app_users: ${uErr.message}`);
  console.log(`app_users total: ${(users ?? []).length}`);
  for (const u of (users ?? []) as {
    role: string;
    is_active: boolean;
    notion_staff_page_id: string | null;
    provisioning_status: string;
  }[]) {
    console.log(
      `  role=${u.role} active=${u.is_active} staff_page=${u.notion_staff_page_id ? "set" : "NULL"} prov=${u.provisioning_status}`,
    );
  }

  const { data: customers, error: cErr } = await supabase
    .from("customer_index")
    .select("display_name,is_archived,sync_status");
  if (cErr) throw new Error(`customer_index: ${cErr.message}`);
  console.log(`customer_index total: ${(customers ?? []).length}`);
  for (const c of (customers ?? []) as {
    display_name: string;
    is_archived: boolean;
    sync_status: string;
  }[]) {
    console.log(
      `  name=${c.display_name} archived=${c.is_archived} sync=${c.sync_status}`,
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
