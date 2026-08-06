/**
 * setup-notion --apply 後の実API検証。
 * トークン・親ページIDはログに出さない。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  SCHEMA_SNAPSHOT_KEY,
  SETUP_STATE_KEY,
  type SetupState,
} from "../src/lib/notion/setup/apply";
import { createNotionClient } from "../src/lib/notion/client-core";
import { SupabaseNotionRateLimiter } from "../src/lib/notion/rate-limiter-core";
import { DATABASES } from "../src/lib/notion/schema/databases";
import {
  INITIAL_MASTERS,
  masterExternalId,
} from "../src/lib/notion/schema/masters";
import { STANDARD_VIEWS } from "../src/lib/notion/schema/views";

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

function richText(prop: unknown): string {
  const p = prop as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  return (p?.rich_text ?? []).map((t) => t.plain_text ?? "").join("");
}

function selectName(prop: unknown): string {
  const p = prop as { select?: { name?: string } } | undefined;
  return p?.select?.name ?? "";
}

async function main() {
  loadEnvLocal();
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!parentPageId || !process.env.NOTION_TOKEN) {
    throw new Error("NOTION_TOKEN / NOTION_PARENT_PAGE_ID が必要です");
  }
  if (!process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Supabase Secret/URL が必要です");
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const rateLimiter = new SupabaseNotionRateLimiter({
    createClient: () => supabase as never,
  });
  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN,
    rateLimiter,
    defaultPriority: "bulk",
  });

  const failures: string[] = [];
  const ok = (msg: string) => console.log(`- [OK] ${msg}`);
  const ng = (msg: string) => {
    failures.push(msg);
    console.log(`- [NG] ${msg}`);
  };

  console.log("## Verify Notion setup");

  const { data: stateRow } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", SETUP_STATE_KEY)
    .maybeSingle();
  const state = stateRow?.value as SetupState | null;
  if (!state) {
    throw new Error("notion_setup_state がありません");
  }
  ok(`notion_setup_state phase=${state.phase}`);
  if (state.notes?.some((n) => n.includes("無題ページ"))) {
    ok("incident note recorded in setup state");
  } else {
    ng("incident note missing in setup state");
  }

  // 親配下の生存DB
  const liveTitles = new Map<string, string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await notion.blocks.children.list({
      block_id: parentPageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of page.results) {
      const b = block as { id: string; type?: string };
      if (b.type !== "child_database") continue;
      const db = (await notion.databases.retrieve({
        database_id: b.id,
      })) as {
        id: string;
        in_trash?: boolean;
        title?: Array<{ plain_text?: string }>;
      };
      if (db.in_trash) continue;
      const title =
        db.title?.map((t) => t.plain_text ?? "").join("").trim() ?? "";
      liveTitles.set(title, db.id);
    }
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }

  const expectedTitles = DATABASES.map((d) => d.title);
  const missing = expectedTitles.filter((t) => !liveTitles.has(t));
  if (missing.length === 0 && liveTitles.size >= 9) {
    ok(`live DBs under parent: ${liveTitles.size} (expected 9 titles present)`);
  } else {
    ng(`live DB titles missing or incomplete: ${missing.join(", ") || "count"}`);
  }

  // IDs / common props / relations
  for (const db of DATABASES) {
    const ids = state.databases[db.key];
    if (!ids?.databaseId || !ids?.dataSourceId) {
      ng(`${db.key}: missing IDs in state`);
      continue;
    }
    if (ids.databaseId === ids.dataSourceId) {
      ng(`${db.key}: database_id === data_source_id`);
    }
    const retrieved = await notion.dataSources.retrieve({
      data_source_id: ids.dataSourceId,
    });
    const props = (
      retrieved as {
        properties: Record<
          string,
          {
            id: string;
            type: string;
            relation?: {
              data_source_id?: string;
              type?: string;
              dual_property?: unknown;
              single_property?: unknown;
            };
          }
        >;
      }
    ).properties;

    for (const name of ["external_id", "作成日時", "更新日時"]) {
      if (!props[name]) ng(`${db.key}: missing ${name}`);
    }

    for (const rel of db.phaseBRelations) {
      if (rel.type !== "relation") continue;
      const p = props[rel.name];
      if (!p || p.type !== "relation") {
        ng(`${db.key}.${rel.name}: relation missing`);
        continue;
      }
      const target = state.databases[rel.target].dataSourceId;
      if (p.relation?.data_source_id !== target) {
        ng(`${db.key}.${rel.name}: target mismatch`);
      }
      const kind =
        p.relation?.type ??
        (p.relation?.dual_property
          ? "dual_property"
          : p.relation?.single_property
            ? "single_property"
            : "unknown");
      const expected = rel.dual ? "dual_property" : "single_property";
      if (kind !== expected) {
        ng(`${db.key}.${rel.name}: kind ${kind} != ${expected}`);
      } else {
        ok(`${db.key}.${rel.name} -> ${rel.target} (${kind})`);
      }
    }
  }

  // Masters count / uniqueness / tags
  const mastersDs = state.databases.masters.dataSourceId!;
  const pages: Array<{
    properties: Record<string, unknown>;
  }> = [];
  let mCursor: string | undefined;
  for (;;) {
    const q = await notion.dataSources.query({
      data_source_id: mastersDs,
      start_cursor: mCursor,
      page_size: 100,
    } as never);
    const body = q as {
      results: Array<{ properties: Record<string, unknown> }>;
      has_more: boolean;
      next_cursor: string | null;
    };
    pages.push(...body.results);
    if (!body.has_more || !body.next_cursor) break;
    mCursor = body.next_cursor;
  }

  if (pages.length === 71) {
    ok(`initial masters count=${pages.length}`);
  } else {
    ng(`initial masters count=${pages.length} expected 71`);
  }

  const byType: Record<string, number> = {};
  const semanticSeen = new Map<string, string>();
  for (const page of pages) {
    const type = selectName(page.properties["マスタ種別"]);
    byType[type] = (byType[type] ?? 0) + 1;
    const sk = richText(page.properties.semantic_key);
    if (sk) {
      const key = `${type}::${sk}`;
      if (semanticSeen.has(key)) {
        ng(`semantic_key duplicate ${key}`);
      } else {
        semanticSeen.set(key, richText(page.properties["名称"]));
      }
    }
  }
  console.log("### masters by type");
  for (const [k, v] of Object.entries(byType).sort()) {
    console.log(`  ${k}: ${v}`);
  }

  // expected seeds present by external_id
  let seedOk = 0;
  for (const seed of INITIAL_MASTERS) {
    const ext = masterExternalId(seed);
    const hit = pages.find(
      (p) => richText(p.properties.external_id) === ext,
    );
    if (!hit) {
      ng(`missing seed ${seed.masterType}/${seed.name}`);
      continue;
    }
    seedOk += 1;
    if (seed.semanticKey) {
      const actual = richText(hit.properties.semantic_key);
      if (actual !== seed.semanticKey) {
        ng(`semantic_key mismatch ${seed.name}: ${actual}`);
      }
    }
    if (seed.semanticTags) {
      const actual = richText(hit.properties.semantic_tags);
      const expected = seed.semanticTags.join(",");
      if (actual !== expected) {
        ng(`semantic_tags mismatch ${seed.name}: ${actual} != ${expected}`);
      }
    }
  }
  ok(`seed external_id matches=${seedOk}/${INITIAL_MASTERS.length}`);

  // snapshot
  const { data: snapRow } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", SCHEMA_SNAPSHOT_KEY)
    .maybeSingle();
  if (snapRow?.value) ok("notion_schema_snapshot saved");
  else ng("notion_schema_snapshot missing");

  const localSnap = resolve(process.cwd(), "config/notion-schema.generated.json");
  if (existsSync(localSnap)) ok("config/notion-schema.generated.json exists");
  else ng("local snapshot file missing");

  // views state
  console.log("### views");
  for (const v of STANDARD_VIEWS) {
    const st = state.views[v.key];
    console.log(
      `  ${v.name}: viewId=${st?.viewId ?? "MANUAL/unset"} manual=${Boolean(v.manualSetupNotes?.length)}`,
    );
  }

  // provisioning
  const { data: users } = await supabase
    .from("app_users")
    .select("id,role,provisioning_status,notion_staff_page_id")
    .eq("role", "admin");
  console.log("### admin provisioning");
  for (const u of users ?? []) {
    console.log(
      `  admin ${u.id.slice(0, 8)}… status=${u.provisioning_status} staff=${u.notion_staff_page_id ? "set" : "null"}`,
    );
  }

  // auth foundation smoke
  const { count: migrationHint } = await supabase
    .from("system_settings")
    .select("*", { count: "exact", head: true });
  ok(`system_settings reachable count_hint=${migrationHint ?? "?"}`);

  if (failures.length > 0) {
    console.error(`\nVERIFY FAILED (${failures.length})`);
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  console.log("\nVERIFY PASSED");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`verify failed: ${message}`);
  process.exit(1);
});
