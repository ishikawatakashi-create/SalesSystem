/**
 * profile_created ユーザーの自社担当者 provisioning（setup完了後の補完用）
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  SETUP_STATE_KEY,
  type SetupState,
} from "../src/lib/notion/setup/apply";
import { createNotionClient } from "../src/lib/notion/client-core";
import { SupabaseNotionRateLimiter } from "../src/lib/notion/rate-limiter-core";
import { staffExternalId } from "../src/lib/notion/provisioning/staff-id";

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
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", SETUP_STATE_KEY)
    .maybeSingle();
  const state = data?.value as SetupState | null;
  if (!state?.databases.staff.dataSourceId) {
    throw new Error("staff data_source_id missing");
  }
  const staffDs = state.databases.staff.dataSourceId;
  const rateLimiter = new SupabaseNotionRateLimiter({
    createClient: () => supabase as never,
  });
  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN!,
    rateLimiter,
    defaultPriority: "bulk",
  });

  const { data: users, error } = await supabase
    .from("app_users")
    .select(
      "id,display_name,role,department_role,is_active,email,provisioning_status",
    )
    .eq("provisioning_status", "profile_created");
  if (error) throw new Error(error.message);

  console.log(`profile_created count=${users?.length ?? 0}`);
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
    let pageId = (existing as { results: Array<{ id: string }> }).results[0]
      ?.id;
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
    const { error: upd } = await supabase
      .from("app_users")
      .update({
        notion_staff_page_id: pageId,
        provisioning_status: "completed",
        provisioning_error: null,
      })
      .eq("id", user.id)
      .eq("provisioning_status", "profile_created");
    if (upd) throw new Error(upd.message);
    console.log(
      `[OK] user=${user.id.slice(0, 8)}… role=${user.role} -> completed`,
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
