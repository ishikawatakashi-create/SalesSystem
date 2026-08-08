/**
 * Phase 12: Organization relationships（Notion「関係性」）を既存 workspace へ冪等適用。
 * 削除は一切しない。ログは件数のみ（secrets / PII なし）。
 *
 * Usage:
 *   npx tsx scripts/apply-phase12-organization-relationship.ts
 *   npx tsx scripts/apply-phase12-organization-relationship.ts --plan
 *   npx tsx scripts/apply-phase12-organization-relationship.ts --apply
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "@notionhq/client";

import { createNotionClient } from "../src/lib/notion/client-core";
import { SupabaseNotionRateLimiter } from "../src/lib/notion/rate-limiter-core";
import {
  MASTER_TYPES,
} from "../src/lib/notion/schema/databases";
import {
  INITIAL_MASTERS,
  masterExternalId,
} from "../src/lib/notion/schema/masters";
import {
  buildPropertySnapshot,
  SCHEMA_SNAPSHOT_KEY,
  SETUP_STATE_KEY,
  type SetupState,
} from "../src/lib/notion/setup/apply";
import {
  ORGANIZATION_RELATIONSHIP_MASTER_TYPE,
  ORGANIZATION_RELATIONSHIP_PROPERTY,
} from "../src/lib/organizations/relationship";

const RELATIONSHIP_SEEDS = INITIAL_MASTERS.filter(
  (m) => m.masterType === ORGANIZATION_RELATIONSHIP_MASTER_TYPE,
);

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
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    if (arg === "--plan") apply = false;
  }
  return { apply };
}

type SelectOption = { id?: string; name: string; color?: string };

type DsProperties = Record<
  string,
  {
    id?: string;
    type: string;
    name?: string;
    select?: { options?: SelectOption[] };
    relation?: {
      data_source_id?: string;
      type?: string;
      single_property?: unknown;
      dual_property?: unknown;
    };
  }
>;

async function resolveDataSourceIds(supabase: {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): Promise<{
          data: { value: unknown } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}): Promise<{
  mastersDs: string;
  customersDs: string;
  setupState: SetupState | null;
}> {
  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", SETUP_STATE_KEY)
    .maybeSingle();
  if (error) throw new Error(`notion_setup_state: ${error.message}`);

  const setupState = (data?.value as SetupState | null) ?? null;
  const mastersDs =
    setupState?.databases?.masters?.dataSourceId ||
    process.env.NOTION_DS_MASTERS ||
    "";
  const customersDs =
    setupState?.databases?.customers?.dataSourceId ||
    process.env.NOTION_DS_CUSTOMERS ||
    "";

  if (!mastersDs) {
    throw new Error(
      "masters data_source_id が未設定です (notion_setup_state / NOTION_DS_MASTERS)",
    );
  }
  if (!customersDs) {
    throw new Error(
      "customers data_source_id が未設定です (notion_setup_state / NOTION_DS_CUSTOMERS)",
    );
  }

  return { mastersDs, customersDs, setupState };
}

async function ensureMasterTypeOption(input: {
  client: Client;
  mastersDs: string;
  apply: boolean;
}): Promise<{ hadOption: boolean; updated: boolean; optionCount: number }> {
  const retrieved = await input.client.dataSources.retrieve({
    data_source_id: input.mastersDs,
  });
  const props = (retrieved as { properties: DsProperties }).properties;
  const masterTypeProp = props["マスタ種別"];
  if (!masterTypeProp || masterTypeProp.type !== "select") {
    throw new Error("masters.マスタ種別 が select ではありません");
  }

  const existing = masterTypeProp.select?.options ?? [];
  const names = new Set(existing.map((o) => o.name));
  const hadOption = names.has(ORGANIZATION_RELATIONSHIP_MASTER_TYPE);

  // MASTER_TYPES を基準に既存をマージ（削除なし・既存 id/color 維持）
  const byName = new Map(existing.map((o) => [o.name, o]));
  for (const name of MASTER_TYPES) {
    if (!byName.has(name)) {
      byName.set(name, { name });
    }
  }
  const merged: SelectOption[] = [...byName.values()];
  const needsUpdate = !hadOption;

  if (!needsUpdate) {
    return { hadOption, updated: false, optionCount: existing.length };
  }

  if (!input.apply) {
    return { hadOption, updated: false, optionCount: merged.length };
  }

  await input.client.dataSources.update({
    data_source_id: input.mastersDs,
    properties: {
      マスタ種別: {
        type: "select",
        select: {
          options: merged.map((o) =>
            o.id
              ? { id: o.id, name: o.name, ...(o.color ? { color: o.color } : {}) }
              : { name: o.name, ...(o.color ? { color: o.color } : {}) },
          ),
        },
      },
    },
  } as never);

  return { hadOption, updated: true, optionCount: merged.length };
}

async function ensureCustomersRelationshipRelation(input: {
  client: Client;
  customersDs: string;
  mastersDs: string;
  apply: boolean;
}): Promise<{ hadProperty: boolean; created: boolean }> {
  const retrieved = await input.client.dataSources.retrieve({
    data_source_id: input.customersDs,
  });
  const props = (retrieved as { properties: DsProperties }).properties;
  const existing = props[ORGANIZATION_RELATIONSHIP_PROPERTY];

  if (existing) {
    if (existing.type !== "relation") {
      throw new Error(
        `customers.${ORGANIZATION_RELATIONSHIP_PROPERTY}: 既存が relation ではありません`,
      );
    }
    return { hadProperty: true, created: false };
  }

  if (!input.apply) {
    return { hadProperty: false, created: false };
  }

  await input.client.dataSources.update({
    data_source_id: input.customersDs,
    properties: {
      [ORGANIZATION_RELATIONSHIP_PROPERTY]: {
        type: "relation",
        relation: {
          data_source_id: input.mastersDs,
          type: "single_property",
          single_property: {},
        },
      },
    },
  } as never);

  const after = await input.client.dataSources.retrieve({
    data_source_id: input.customersDs,
  });
  const afterProp = (after as { properties: DsProperties }).properties[
    ORGANIZATION_RELATIONSHIP_PROPERTY
  ];
  if (!afterProp || afterProp.type !== "relation") {
    throw new Error(
      `customers.${ORGANIZATION_RELATIONSHIP_PROPERTY}: relation 作成後に検証失敗`,
    );
  }
  if (afterProp.relation?.data_source_id !== input.mastersDs) {
    throw new Error(
      `customers.${ORGANIZATION_RELATIONSHIP_PROPERTY}: 参照先 data_source_id が不一致`,
    );
  }

  return { hadProperty: false, created: true };
}

async function seedRelationshipMasters(input: {
  client: Client;
  mastersDs: string;
  apply: boolean;
}): Promise<{ seedTotal: number; alreadyPresent: number; created: number }> {
  let alreadyPresent = 0;
  let created = 0;

  for (const seed of RELATIONSHIP_SEEDS) {
    const externalId = masterExternalId(seed);
    const found = await input.client.dataSources.query({
      data_source_id: input.mastersDs,
      filter: {
        property: "external_id",
        rich_text: { equals: externalId },
      },
      page_size: 1,
    } as never);
    const results = (found as { results: unknown[] }).results;
    if (results.length > 0) {
      alreadyPresent += 1;
      continue;
    }

    if (!input.apply) continue;

    await input.client.pages.create({
      parent: { type: "data_source_id", data_source_id: input.mastersDs },
      properties: {
        名称: { title: [{ text: { content: seed.name } }] },
        external_id: {
          rich_text: [{ text: { content: externalId } }],
        },
        マスタ種別: { select: { name: seed.masterType } },
        ...(seed.semanticKey
          ? {
              semantic_key: {
                rich_text: [{ text: { content: seed.semanticKey } }],
              },
            }
          : {}),
        ...(seed.semanticTags
          ? {
              semantic_tags: {
                rich_text: [
                  { text: { content: seed.semanticTags.join(",") } },
                ],
              },
            }
          : {}),
        表示順: { number: seed.sortOrder },
        色: { select: { name: seed.color ?? "default" } },
        有効: { checkbox: seed.isActive },
      },
    } as never);
    created += 1;
  }

  return {
    seedTotal: RELATIONSHIP_SEEDS.length,
    alreadyPresent,
    created: input.apply ? created : 0,
  };
}

async function rebuildAndSaveSnapshot(input: {
  client: Client;
  setupState: SetupState;
  supabase: ReturnType<typeof createClient>;
}): Promise<void> {
  const snapshot = await buildPropertySnapshot(input.client, input.setupState);

  await input.supabase.from("system_settings").upsert({
    key: SCHEMA_SNAPSHOT_KEY,
    value: snapshot as never,
    updated_at: new Date().toISOString(),
  });

  const localPath = resolve(
    process.cwd(),
    "config/notion-schema.generated.json",
  );
  await mkdir(resolve(process.cwd(), "config"), { recursive: true });
  await writeFile(localPath, JSON.stringify(snapshot, null, 2), "utf8");
}

async function main() {
  loadEnvLocal();
  const { apply } = parseArgs(process.argv.slice(2));

  console.log("## Phase 12 organization relationship");
  console.log(`mode=${apply ? "apply" : "plan"}`);
  console.log(`relationship_seeds=${RELATIONSHIP_SEEDS.length}`);
  console.log(`master_types=${MASTER_TYPES.length}`);

  if (!process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_URL が必要です");
  }
  if (apply && !process.env.NOTION_TOKEN) {
    throw new Error("--apply には NOTION_TOKEN が必要です");
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { mastersDs, customersDs, setupState } =
    await resolveDataSourceIds(supabase);
  console.log(
    `- ds: masters=[set:len=${mastersDs.length}] customers=[set:len=${customersDs.length}]`,
  );
  console.log(
    `- notion_setup_state=${setupState ? "present" : "absent (env DS fallback)"}`,
  );

  if (!apply) {
    // plan: Notion を読むだけ（変更しない）。トークンがあれば現状確認。
    if (!process.env.NOTION_TOKEN) {
      console.log(
        "\nStopped at plan mode (NOTION_TOKEN unset). Pass --apply with token to mutate.",
      );
      console.log(
        `plan: ensure select option「${ORGANIZATION_RELATIONSHIP_MASTER_TYPE}」`,
      );
      console.log(
        `plan: ensure customers relation「${ORGANIZATION_RELATIONSHIP_PROPERTY}」→ masters`,
      );
      console.log(
        `plan: seed relationship masters total=${RELATIONSHIP_SEEDS.length} (idempotent by external_id)`,
      );
      console.log("plan: rebuild property snapshot → system_settings + local JSON");
      return;
    }
  }

  const rateLimiter = new SupabaseNotionRateLimiter({
    createClient: () => supabase as never,
  });
  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN!,
    rateLimiter,
    defaultPriority: "bulk",
  });

  const selectResult = await ensureMasterTypeOption({
    client: notion,
    mastersDs,
    apply,
  });
  console.log(
    `- master_type_option「${ORGANIZATION_RELATIONSHIP_MASTER_TYPE}」: had=${selectResult.hadOption} updated=${selectResult.updated} option_count=${selectResult.optionCount}`,
  );

  const relationResult = await ensureCustomersRelationshipRelation({
    client: notion,
    customersDs,
    mastersDs,
    apply,
  });
  console.log(
    `- customers.relation「${ORGANIZATION_RELATIONSHIP_PROPERTY}」: had=${relationResult.hadProperty} created=${relationResult.created}`,
  );

  const seedResult = await seedRelationshipMasters({
    client: notion,
    mastersDs,
    apply,
  });
  console.log(
    `- seeds: total=${seedResult.seedTotal} already_present=${seedResult.alreadyPresent} created=${seedResult.created}`,
  );

  if (!apply) {
    console.log("\nStopped at plan mode. Pass --apply to mutate Notion.");
    console.log("plan: rebuild property snapshot (skipped in plan)");
    return;
  }

  if (!setupState?.databases) {
    throw new Error(
      "snapshot 再構築には notion_setup_state.databases が必要です",
    );
  }

  // env 由来 DS を state へ反映（欠落時のみ）
  if (!setupState.databases.masters.dataSourceId) {
    setupState.databases.masters.dataSourceId = mastersDs;
  }
  if (!setupState.databases.customers.dataSourceId) {
    setupState.databases.customers.dataSourceId = customersDs;
  }

  await rebuildAndSaveSnapshot({ client: notion, setupState, supabase });
  console.log("- snapshot: rebuilt and saved (system_settings + config/notion-schema.generated.json)");
  console.log("\nApply finished.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`apply-phase12-organization-relationship failed: ${message}`);
  process.exit(1);
});
