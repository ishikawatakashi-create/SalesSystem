/**
 * Notion 9DBセットアップCLI。
 * 既定はplanのみ(--applyなしではNotionへ変更しない)。
 *
 * Usage:
 *   npx tsx scripts/setup-notion.ts
 *   npx tsx scripts/setup-notion.ts --parent-page-id=<id>
 *   npx tsx scripts/setup-notion.ts --apply --parent-page-id=<id>
 *   npx tsx scripts/setup-notion.ts --apply --resume   # 冪等再実行(既存stateあり)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "@notionhq/client";

import {
  buildSetupPlan,
  formatSetupPlan,
} from "../src/lib/notion/setup/plan";
import {
  applyNotionSetup,
  SCHEMA_SNAPSHOT_KEY,
  SETUP_STATE_KEY,
  type SetupState,
  type SetupStore,
} from "../src/lib/notion/setup/apply";
import {
  assertParentPageReady,
  findConflictingLiveDatabases,
} from "../src/lib/notion/setup/guards";
import { createNotionClient } from "../src/lib/notion/client-core";
import { SupabaseNotionRateLimiter } from "../src/lib/notion/rate-limiter-core";
import { NOTION_API_VERSION } from "../src/lib/notion/version";
import { staffExternalId } from "../src/lib/notion/provisioning/staff-id";
import { INITIAL_MASTERS } from "../src/lib/notion/schema/masters";
import { STANDARD_VIEWS } from "../src/lib/notion/schema/views";
import { DATABASES } from "../src/lib/notion/schema/databases";

const INCIDENT_NOTE =
  "2026-08-06: read-only preflightの初回insertプローブが無題ページを1件誤作成。ゴミ箱へ移動済み。ゴミ箱内ページは既存DB/setup対象として扱わない。";

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

function parseArgs(argv: string[]) {
  let apply = false;
  let resume = false;
  let parentPageId: string | null = null;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    if (arg === "--resume") resume = true;
    if (arg.startsWith("--parent-page-id=")) {
      parentPageId = arg.slice("--parent-page-id=".length).trim() || null;
    }
  }
  return { apply, resume, parentPageId };
}

async function main() {
  loadEnvLocal();
  const {
    apply,
    resume,
    parentPageId: argParent,
  } = parseArgs(process.argv.slice(2));
  const parentPageId =
    argParent || process.env.NOTION_PARENT_PAGE_ID || null;

  const plan = buildSetupPlan({ apply, parentPageId });
  console.log(formatSetupPlan(plan));
  console.log("");
  console.log(`Incident note: ${INCIDENT_NOTE}`);

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
      if (!state.notes?.includes(INCIDENT_NOTE)) {
        state.notes = [...(state.notes ?? []), INCIDENT_NOTE];
      }
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

  console.log("\n## Pre-apply checks");
  console.log(`api_version: ${NOTION_API_VERSION}`);
  console.log("NOTION_TOKEN: [set]");
  console.log(
    `NOTION_PARENT_PAGE_ID: [set:len=${parentPageId.length},prefix=${parentPageId.slice(0, 4)}…]`,
  );

  const existingState = await store.load();
  if (existingState && !resume) {
    throw new Error(
      "notion_setup_state が既に存在します。冪等再実行は --resume を付けてください",
    );
  }
  if (!existingState && resume) {
    throw new Error("--resume が指定されましたが notion_setup_state がありません");
  }
  if (!existingState) {
    console.log("- [OK] notion_setup_state absent (first apply)");
  } else {
    console.log(
      `- [OK] notion_setup_state present (resume phase=${existingState.phase})`,
    );
  }

  const rateLimiter = new SupabaseNotionRateLimiter({
    createClient: () => supabase as never,
  });
  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN,
    rateLimiter,
    defaultPriority: "bulk",
  });

  await assertParentPageReady({ client: notion, parentPageId });
  console.log("- [OK] parent readable and not in_trash");

  const conflicts = await findConflictingLiveDatabases({
    client: notion,
    parentPageId,
    state: existingState,
  });
  if (conflicts.length > 0) {
    throw new Error(
      `親配下に生存中の同名DBがあります(再利用しない): ${conflicts.map((c) => c.title).join(", ")}`,
    );
  }
  console.log("- [OK] no unexpected live same-name databases under parent");
  console.log(
    `- [OK] plan masters=${INITIAL_MASTERS.length} views=${STANDARD_VIEWS.length} dbs=${DATABASES.length}`,
  );

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
  if (state.notes?.length) {
    console.log("\n## Notes");
    for (const note of state.notes) console.log(`- ${note}`);
  }

  const manualViews = STANDARD_VIEWS.filter(
    (v) => (v.manualSetupNotes?.length ?? 0) > 0 || !state.views[v.key]?.viewId,
  );
  console.log("\n## Views");
  for (const v of STANDARD_VIEWS) {
    const st = state.views[v.key];
    const status = st?.viewId
      ? `created view_id=${st.viewId}`
      : "MANUAL/pending (API未作成またはSDK未対応)";
    console.log(`- ${v.name}: ${status}`);
  }
  if (manualViews.length > 0) {
    console.log("\n## MANUAL view notes");
    for (const v of manualViews) {
      console.log(`- ${v.name}`);
      for (const note of v.manualSetupNotes ?? ["viewId未保存"]) {
        console.log(`  - ${note}`);
      }
    }
  }

  console.log("Set NOTION_DS_* from data_source_id values into .env.local");
  console.log(`Snapshot written to ${localPath} (gitignored)`);

  if (!resume) {
    await provisionProfileCreatedUsers(notion, supabase, state);
  } else {
    console.log("\n## Staff provisioning skipped on --resume (idempotent re-run)");
  }
}

async function provisionProfileCreatedUsers(
  notion: Client,
  supabase: unknown,
  state: SetupState,
) {
  const db = supabase as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => Promise<{
          data: Array<{
            id: string;
            display_name: string;
            role: string;
            department_role: string | null;
            is_active: boolean;
            email: string;
          }> | null;
          error: { message: string } | null;
        }>;
      };
      update: (values: {
        notion_staff_page_id: string;
        provisioning_status: string;
        provisioning_error: null;
      }) => {
        eq: (
          column: string,
          value: string,
        ) => {
          eq: (
            column: string,
            value: string,
          ) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
  };

  const staffDs = state.databases.staff.dataSourceId;
  if (!staffDs) {
    console.log("\nProvisioning skipped: staff data_source_id missing");
    return;
  }

  const { data: users, error } = await db
    .from("app_users")
    .select(
      "id,display_name,role,department_role,is_active,email,provisioning_status",
    )
    .eq("provisioning_status", "profile_created");

  if (error) {
    throw new Error(`profile_createdユーザー取得失敗: ${error.message}`);
  }

  console.log(`\n## Staff provisioning (count=${users?.length ?? 0})`);
  for (const user of users ?? []) {
    const externalId = staffExternalId(user.id);
    const existing = await notion.dataSources.query({
      data_source_id: staffDs,
      filter: {
        property: "external_id",
        rich_text: { equals: externalId },
      },
      page_size: 1,
    } as never);
    const results = (existing as { results: Array<{ id: string }> }).results;
    let pageId = results[0]?.id;

    if (!pageId) {
      const created = await notion.pages.create({
        parent: { type: "data_source_id", data_source_id: staffDs },
        properties: {
          氏名: {
            title: [{ text: { content: user.display_name } }],
          },
          external_id: {
            rich_text: [{ text: { content: externalId } }],
          },
          メールアドレス: { email: user.email },
          ロール: {
            rich_text: [{ text: { content: user.role } }],
          },
          "所属・役割": {
            rich_text: [{ text: { content: user.department_role ?? "" } }],
          },
          有効: { checkbox: user.is_active },
        },
      } as never);
      pageId = (created as { id: string }).id;
    }

    const { error: updError } = await db
      .from("app_users")
      .update({
        notion_staff_page_id: pageId,
        provisioning_status: "completed",
        provisioning_error: null,
      })
      .eq("id", user.id)
      .eq("provisioning_status", "profile_created");

    if (updError) {
      throw new Error(`provisioning更新失敗: ${updError.message}`);
    }
    console.log(`- [OK] user_id=${user.id.slice(0, 8)}… -> completed`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`setup-notion failed: ${message}`);
  process.exit(1);
});
