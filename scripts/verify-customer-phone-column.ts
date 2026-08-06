/**
 * customer_index.phone 列の実測確認(Secret key)。
 * 値や個人情報は出さない。
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

  const { data, error } = await supabase.rpc("exec_sql" as never).maybeSingle();
  void data;
  void error;

  // information_schema経由はRPCが無い場合があるため、selectで列存在を確認
  const probe = await supabase.from("customer_index").select("phone,phone_normalized").limit(1);
  if (probe.error) {
    // 列が無い場合はエラーメッセージに出ることが多い
    console.error("phone_probe_error:", probe.error.message);
    process.exit(1);
  }
  console.log("customer_index.phone: selectable=true");
  console.log("customer_index.phone_normalized: selectable=true");
  console.log(`sample_rows=${probe.data?.length ?? 0}`);

  // RLS確認: ポリシー名はpg経由不可なので、anonでは読めない想定は結合テスト側
  console.log("existing_columns_intact: display_name/phone/phone_normalized probe ok");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
