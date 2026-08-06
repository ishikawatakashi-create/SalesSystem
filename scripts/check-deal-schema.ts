/**
 * deal_index列・案件マスタsemantic_key・snapshot dealsプロパティ確認。
 * 個人情報は出さない。
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

  const candidates = [
    "notion_page_id",
    "title",
    "customer_page_id",
    "contact_page_ids",
    "business_category_id",
    "product_name",
    "stage_id",
    "status_id",
    "status_semantic",
    "staff_user_ids",
    "staff_page_ids",
    "expected_amount",
    "contract_amount",
    "probability",
    "expected_close_date",
    "contracted_at",
    "period_start",
    "period_end",
    "next_action",
    "next_action_date",
    "lost_reason",
    "note",
    "search_text",
    "phone",
  ];
  for (const col of candidates) {
    const r = await s.from("deal_index").select(col).limit(0);
    console.log(`deal_index.${col}: ${r.error ? "MISSING" : "ok"}`);
  }
  const { count } = await s
    .from("deal_index")
    .select("*", { count: "exact", head: true });
  console.log("deal_index count:", count);

  for (const type of ["案件ステージ", "案件ステータス"]) {
    const { data } = await s
      .from("masters_cache")
      .select("name,semantic_key,is_active,master_type")
      .eq("master_type", type)
      .order("sort_order", { ascending: true });
    console.log(type, "count=", data?.length);
    for (const m of data ?? []) {
      console.log(
        `  ${m.name} key=${m.semantic_key ?? "NULL"} active=${m.is_active}`,
      );
    }
  }

  const { data: snap } = await s
    .from("system_settings")
    .select("value")
    .eq("key", "notion_schema_snapshot")
    .maybeSingle();
  const deals = (
    snap?.value as {
      databases?: {
        deals?: {
          dataSourceId?: string;
          properties?: Record<string, { id: string; name: string; type: string }>;
        };
      };
    }
  )?.databases?.deals;
  console.log("NOTION_DS_DEALS env set:", Boolean(process.env.NOTION_DS_DEALS));
  console.log("snapshot deals ds:", deals?.dataSourceId ? "set" : "missing");
  console.log(
    "deal props:",
    Object.keys(deals?.properties ?? {})
      .sort()
      .join(", "),
  );

  const { data: contacts } = await s
    .from("contact_index")
    .select("notion_page_id,name,customer_page_id,is_active")
    .ilike("name", "test_%")
    .eq("is_active", true)
    .limit(5);
  console.log(
    "test contacts:",
    (contacts ?? []).map((c) => ({
      active: c.is_active,
      hasCustomer: Boolean(c.customer_page_id),
      namePrefix: String(c.name).slice(0, 24),
    })),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
