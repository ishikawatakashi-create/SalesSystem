/**
 * Notion 9DBセットアップCLI。
 * 既定はplanのみ(--applyなしではNotionへ変更しない)。
 *
 * Usage:
 *   npx tsx scripts/setup-notion.ts
 *   npx tsx scripts/setup-notion.ts --parent-page-id=<id>
 *   npx tsx scripts/setup-notion.ts --apply --parent-page-id=<id>
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import {
  buildSetupPlan,
  formatSetupPlan,
} from "../src/lib/notion/setup/plan";
import {
  applyNotionSetup,
  emptySetupState,
  SCHEMA_SNAPSHOT_KEY,
  SETUP_STATE_KEY,
  type SetupState,
  type SetupStore,
} from "../src/lib/notion/setup/apply";

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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseArgs(argv: string[]) {
  let apply = false;
  let parentPageId: string | null = null;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    if (arg.startsWith("--parent-page-id=")) {
      parentPageId = arg.slice("--parent-page-id=".length).trim() || null;
    }
  }
  return { apply, parentPageId };
}

async function main() {
  loadEnvLocal();
  const { apply, parentPageId: argParent } = parseArgs(process.argv.slice(2));
  const parentPageId =
    argParent || process.env.NOTION_PARENT_PAGE_ID || null;

  const plan = buildSetupPlan({ apply, parentPageId });
  console.log(formatSetupPlan(plan));

  if (!apply) {
    console.log("\nStopped at plan mode. Pass --apply to mutate Notion.");
    return;
  }

  if (!parentPageId) {
    throw new Error(
      "--applyには NOTION_PARENT_PAGE_ID または --parent-page-id が必要です",
    );
  }
  if (!process.env.NOTION_TOKEN) {
    throw new Error("--applyには NOTION_TOKEN が必要です");
  }
  if (!process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("--applyにはSupabase Secret/URLが必要です(system_settings保存用)");
  }

  // 動的importでserver-only境界を回避(CLIコンテキスト)
  const { createClient } = await import("@supabase/supabase-js");
  const { createNotionClient } = await import("../src/lib/notion/client-core");
  const { SupabaseNotionRateLimiter } = await import(
    "../src/lib/notion/rate-limiter-core"
  );

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const store: SetupStore = {
    async load() {
      const { data } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", SETUP_STATE_KEY)
        .maybeSingle();
      return (data?.value as SetupState | null) ?? null;
    },
    async save(state) {
      await supabase.from("system_settings").upsert({
        key: SETUP_STATE_KEY,
        value: state as never,
        updated_at: new Date().toISOString(),
      });
    },
    async saveSnapshot(snapshot) {
      await supabase.from("system_settings").upsert({
        key: SCHEMA_SNAPSHOT_KEY,
        value: snapshot as never,
        updated_at: new Date().toISOString(),
      });
    },
  };

  const rateLimiter = new SupabaseNotionRateLimiter({
    createClient: () => supabase as never,
  });
  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN,
    rateLimiter,
    defaultPriority: "bulk",
  });

  const localPath = resolve(
    process.cwd(),
    "config/notion-schema.generated.json",
  );
  await mkdir(resolve(process.cwd(), "config"), { recursive: true });

  const state = await applyNotionSetup({
    client: notion,
    parentPageId,
    store,
    writeLocalSnapshot: async (snapshot) => {
      await writeFile(localPath, JSON.stringify(snapshot, null, 2), "utf8");
    },
  });

  console.log("\nApply finished.");
  console.log(`phase=${state.phase}`);
  for (const [key, ids] of Object.entries(state.databases)) {
    console.log(
      `- ${key}: database_id=${ids.databaseId ?? "-"} data_source_id=${ids.dataSourceId ?? "-"}`,
    );
  }
  console.log("Set NOTION_DS_* from data_source_id values into .env.local");
  console.log(`Snapshot written to ${localPath} (gitignored)`);

  // 既存状態ファイル確認用(トークンは含めない)
  void emptySetupState;
  void readFile;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`setup-notion failed: ${message}`);
  process.exit(1);
});
