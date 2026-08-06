/**
 * Notion営業マスタ → masters_cache 初期同期(冪等・削除なし)。
 * トークン・ページIDの全文はログに出さない。
 *
 * Usage: npx tsx scripts/sync-masters-cache.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { createNotionClient } from "../src/lib/notion/client-core";
import { SupabaseNotionRateLimiter } from "../src/lib/notion/rate-limiter-core";
import {
  extractMastersPropertyMap,
  syncMastersCache,
  type MastersCacheUpsertRow,
} from "../src/lib/masters/sync-core";

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
  const mastersDs = process.env.NOTION_DS_MASTERS;
  if (!mastersDs) throw new Error("NOTION_DS_MASTERS が設定されていません");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: snapshotRow, error: snapErr } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "notion_schema_snapshot")
    .maybeSingle();
  if (snapErr) throw new Error(snapErr.message);
  const propertiesByName = extractMastersPropertyMap(snapshotRow?.value);

  const rateLimiter = new SupabaseNotionRateLimiter({
    createClient: () => supabase as never,
  });
  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN!,
    rateLimiter,
    defaultPriority: "bulk",
  });

  const result = await syncMastersCache({
    notion,
    mastersDataSourceId: mastersDs,
    propertiesByName,
    store: {
      async upsert(rows: MastersCacheUpsertRow[]) {
        const { error } = await supabase
          .from("masters_cache")
          .upsert(rows as never[], { onConflict: "notion_page_id" });
        if (error) throw new Error(error.message);
      },
    },
  });

  console.log(`upserted: ${result.upserted}`);
  console.log(`skipped_in_trash: ${result.skippedInTrash}`);
  for (const [type, count] of Object.entries(result.byType).sort()) {
    console.log(`  ${type}: ${count}`);
  }

  const { count } = await supabase
    .from("masters_cache")
    .select("*", { count: "exact", head: true });
  console.log(`masters_cache total after sync: ${count}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
