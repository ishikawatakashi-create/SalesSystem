/**
 * contact_index / 担当者区分 / contacts schema 確認
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
    if (value) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Probe columns via select-each (PostgREST returns error for missing cols)
  const { error } = await s.from("contact_index").select("*").limit(0);
  console.log("contact_index error:", error?.message ?? "ok");
  // Get columns via a known empty table and PostgREST - try selecting each candidate
  const candidates = [
    "notion_page_id",
    "external_id",
    "content_hash",
    "notion_last_edited_at",
    "sync_status",
    "sync_error_message",
    "last_synced_at",
    "created_at",
    "updated_at",
    "name",
    "name_kana",
    "customer_page_id",
    "customer_notion_page_id",
    "department",
    "title",
    "phone",
    "phone_normalized",
    "email",
    "contact_type_id",
    "contact_type_ids",
    "note",
    "is_active",
    "search_text",
  ];
  for (const col of candidates) {
    const r = await s.from("contact_index").select(col).limit(0);
    console.log(`  col ${col}: ${r.error ? "MISSING " + r.error.message : "ok"}`);
  }

  const { count } = await s
    .from("contact_index")
    .select("*", { count: "exact", head: true });
  console.log("contact_index count:", count);

  const { data: masters } = await s
    .from("masters_cache")
    .select("notion_page_id,name,is_active,master_type")
    .eq("master_type", "担当者区分");
  console.log("担当者区分 count:", masters?.length);
  console.log(JSON.stringify(masters));

  const { data: cust } = await s
    .from("customer_index")
    .select("notion_page_id,display_name,is_archived")
    .eq("is_archived", false)
    .ilike("display_name", "test_%")
    .limit(5);
  console.log("active test customers:", JSON.stringify(cust));

  const { data: snap } = await s
    .from("system_settings")
    .select("value")
    .eq("key", "notion_schema_snapshot")
    .maybeSingle();
  const contacts = (snap?.value as { databases?: { contacts?: unknown } })
    ?.databases?.contacts as {
    dataSourceId?: string;
    properties?: Record<string, { id: string; name: string; type: string }>;
  };
  console.log("NOTION_DS_CONTACTS env:", process.env.NOTION_DS_CONTACTS || "(empty)");
  console.log("snapshot contacts ds:", contacts?.dataSourceId);
  console.log(
    "snapshot props:",
    JSON.stringify(contacts?.properties ?? {}, null, 2),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
