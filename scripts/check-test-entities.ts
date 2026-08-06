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
  const { count: cc } = await s
    .from("contact_index")
    .select("*", { count: "exact", head: true });
  console.log("contact_index total", cc);
  const { data: contacts } = await s
    .from("contact_index")
    .select("name,customer_page_id,is_active")
    .limit(10);
  console.log(
    "contacts sample",
    (contacts ?? []).map((c) => ({
      n: String(c.name).slice(0, 32),
      active: c.is_active,
      cust: c.customer_page_id ? "set" : "null",
    })),
  );
  const { data: cust } = await s
    .from("customer_index")
    .select("display_name,is_archived,expected_amount")
    .ilike("display_name", "test_%")
    .limit(10);
  console.log(
    "test customers",
    (cust ?? []).map((c) => ({
      n: String(c.display_name).slice(0, 40),
      archived: c.is_archived,
      amount: c.expected_amount,
    })),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
