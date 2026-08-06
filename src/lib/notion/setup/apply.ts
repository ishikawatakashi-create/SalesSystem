/**
 * Notion setup applyエンジン。
 * planモードでは呼ばない。--apply時のみ使用。
 * 部分実行再開のためsystem_settingsへ状態を保存する。
 */

import type { Client } from "@notionhq/client";

import { DATABASES, type NotionDbKey } from "@/lib/notion/schema/databases";
import { INITIAL_MASTERS, masterExternalId } from "@/lib/notion/schema/masters";
import { STANDARD_VIEWS } from "@/lib/notion/schema/views";

export type SetupState = {
  schemaVersion: string;
  updatedAt: string;
  parentPageId: string;
  phase: "a" | "b" | "c" | "done";
  databases: Record<
    NotionDbKey,
    {
      databaseId?: string;
      dataSourceId?: string;
      title: string;
    }
  >;
  views: Record<string, { viewId?: string; name: string; databaseKey: NotionDbKey }>;
  mastersSeeded: boolean;
  snapshotSaved: boolean;
};

export const SETUP_STATE_KEY = "notion_setup_state";
export const SCHEMA_SNAPSHOT_KEY = "notion_schema_snapshot";
export const SETUP_SCHEMA_VERSION = "phase1-2026-08-06";

export function emptySetupState(parentPageId: string): SetupState {
  const databases = {} as SetupState["databases"];
  for (const db of DATABASES) {
    databases[db.key] = { title: db.title };
  }
  const views = {} as SetupState["views"];
  for (const v of STANDARD_VIEWS) {
    views[v.key] = { name: v.name, databaseKey: v.databaseKey };
  }
  return {
    schemaVersion: SETUP_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    parentPageId,
    phase: "a",
    databases,
    views,
    mastersSeeded: false,
    snapshotSaved: false,
  };
}

export type SetupStore = {
  load(): Promise<SetupState | null>;
  save(state: SetupState): Promise<void>;
  saveSnapshot(snapshot: unknown): Promise<void>;
};

/**
 * apply実行。Notion Clientはレートリミッター経由済みであること。
 * 既作成のDB/プロパティ/マスタ/ビューは重複作成しない。
 * --resetは実装しない。
 */
export async function applyNotionSetup(input: {
  client: Client;
  parentPageId: string;
  store: SetupStore;
  writeLocalSnapshot: (snapshot: unknown) => Promise<void>;
}): Promise<SetupState> {
  const state =
    (await input.store.load()) ?? emptySetupState(input.parentPageId);
  if (state.parentPageId !== input.parentPageId) {
    throw new Error(
      "保存済みsetup状態のparentPageIdが一致しません。別環境の状態を流用していませんか",
    );
  }

  // Phase A
  for (const db of DATABASES) {
    const current = state.databases[db.key];
    if (current.databaseId && current.dataSourceId) continue;

    const created = await input.client.databases.create({
      parent: { type: "page_id", page_id: input.parentPageId },
      title: [{ type: "text", text: { content: db.title } }],
      initial_data_source: {
        properties: toNotionProperties(db.phaseAProperties),
      },
    } as never);

    const verified = await input.client.databases.retrieve({
      database_id: (created as { id: string }).id,
    });
    const dataSources = (verified as { data_sources?: Array<{ id: string }> })
      .data_sources;
    const dataSourceId = dataSources?.[0]?.id;
    if (!dataSourceId) {
      throw new Error(`${db.title}: data_source_idを取得できませんでした`);
    }

    state.databases[db.key] = {
      title: db.title,
      databaseId: (created as { id: string }).id,
      dataSourceId,
    };
    state.updatedAt = new Date().toISOString();
    state.phase = "a";
    await input.store.save(state);
  }

  // Phase B relations
  state.phase = "b";
  for (const key of DATABASES.map((d) => d.key)) {
    const db = DATABASES.find((d) => d.key === key)!;
    const dsId = state.databases[key].dataSourceId!;
    const retrieved = await input.client.dataSources.retrieve({
      data_source_id: dsId,
    });
    const existingProps = (retrieved as { properties: Record<string, { type: string }> })
      .properties;

    for (const prop of db.phaseBRelations) {
      if (prop.type !== "relation") continue;
      if (existingProps[prop.name]) continue;
      const targetDs = state.databases[prop.target].dataSourceId;
      if (!targetDs) {
        throw new Error(`relation対象 ${prop.target} のdata_source_idが未確定`);
      }
      await input.client.dataSources.update({
        data_source_id: dsId,
        properties: {
          [prop.name]: {
            type: "relation",
            relation: {
              data_source_id: targetDs,
              ...(prop.single
                ? { type: "single_property", single_property: {} }
                : { type: "dual_property", dual_property: {} }),
            },
          },
        },
      } as never);
    }
    state.updatedAt = new Date().toISOString();
    await input.store.save(state);
  }

  // Phase C masters (idempotent by external_id query)
  if (!state.mastersSeeded) {
    const mastersDs = state.databases.masters.dataSourceId!;
    for (const seed of INITIAL_MASTERS) {
      const externalId = masterExternalId(seed);
      const found = await input.client.dataSources.query({
        data_source_id: mastersDs,
        filter: {
          property: "external_id",
          rich_text: { equals: externalId },
        },
        page_size: 1,
      } as never);
      const results = (found as { results: unknown[] }).results;
      if (results.length > 0) continue;

      await input.client.pages.create({
        parent: { type: "data_source_id", data_source_id: mastersDs },
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
    }
    state.mastersSeeded = true;
    state.updatedAt = new Date().toISOString();
    await input.store.save(state);
  }

  // Phase C views
  for (const view of STANDARD_VIEWS) {
    const current = state.views[view.key];
    if (current?.viewId) continue;
    const databaseId = state.databases[view.databaseKey].databaseId!;
    const dataSourceId = state.databases[view.databaseKey].dataSourceId!;

    // 既存ビュー一覧(重複防止)。APIがviews.listを持つ場合に使用。
    const listFn = (input.client as unknown as {
      views?: { list?: (args: unknown) => Promise<{ results: Array<{ id: string; name?: string }> }> };
    }).views?.list;

    if (listFn) {
      const listed = await listFn({
        database_id: databaseId,
        data_source_id: dataSourceId,
      });
      const existing = listed.results.find((v) => v.name === view.name);
      if (existing) {
        state.views[view.key] = {
          viewId: existing.id,
          name: view.name,
          databaseKey: view.databaseKey,
        };
        await input.store.save(state);
        continue;
      }
    }

    const createFn = (input.client as unknown as {
      views?: { create?: (args: unknown) => Promise<{ id: string }> };
    }).views?.create;

    if (!createFn) {
      // Views APIがSDKに無い場合は状態にmanual保留として残す
      state.views[view.key] = {
        name: view.name,
        databaseKey: view.databaseKey,
      };
      continue;
    }

    const created = await createFn({
      parent: {
        type: "data_source_id",
        database_id: databaseId,
        data_source_id: dataSourceId,
      },
      type: view.type,
      name: view.name,
    });
    state.views[view.key] = {
      viewId: created.id,
      name: view.name,
      databaseKey: view.databaseKey,
    };
    state.updatedAt = new Date().toISOString();
    await input.store.save(state);
  }

  // Snapshot
  const snapshot = await buildPropertySnapshot(input.client, state);
  await input.store.saveSnapshot(snapshot);
  await input.writeLocalSnapshot(snapshot);
  state.snapshotSaved = true;
  state.phase = "done";
  state.updatedAt = new Date().toISOString();
  await input.store.save(state);
  return state;
}

function toNotionProperties(
  props: Array<{ name: string; type: string; options?: Array<{ name: string }>; format?: string }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of props) {
    switch (p.type) {
      case "title":
        out[p.name] = { title: {} };
        break;
      case "rich_text":
        out[p.name] = { rich_text: {} };
        break;
      case "number":
        out[p.name] = {
          number: {
            format:
              p.format === "yen"
                ? "yen"
                : p.format === "percent"
                  ? "percent"
                  : "number",
          },
        };
        break;
      case "checkbox":
        out[p.name] = { checkbox: {} };
        break;
      case "url":
        out[p.name] = { url: {} };
        break;
      case "email":
        out[p.name] = { email: {} };
        break;
      case "phone_number":
        out[p.name] = { phone_number: {} };
        break;
      case "date":
        out[p.name] = { date: {} };
        break;
      case "files":
        out[p.name] = { files: {} };
        break;
      case "created_time":
        out[p.name] = { created_time: {} };
        break;
      case "last_edited_time":
        out[p.name] = { last_edited_time: {} };
        break;
      case "select":
        out[p.name] = {
          select: {
            options: (p.options ?? []).map((o) => ({ name: o.name })),
          },
        };
        break;
      default:
        throw new Error(`unsupported property type in Phase A: ${p.type}`);
    }
  }
  return out;
}

export async function buildPropertySnapshot(
  client: Client,
  state: SetupState,
): Promise<{
  schemaVersion: string;
  generatedAt: string;
  databases: Record<
    string,
    {
      databaseId: string;
      dataSourceId: string;
      title: string;
      properties: Record<string, { id: string; name: string; type: string }>;
    }
  >;
}> {
  const databases: Record<
    string,
    {
      databaseId: string;
      dataSourceId: string;
      title: string;
      properties: Record<string, { id: string; name: string; type: string }>;
    }
  > = {};

  for (const db of DATABASES) {
    const ids = state.databases[db.key];
    if (!ids.databaseId || !ids.dataSourceId) {
      throw new Error(`${db.title}: ID未確定のためスナップショット不可`);
    }
    const retrieved = await client.dataSources.retrieve({
      data_source_id: ids.dataSourceId,
    });
    const props = (retrieved as {
      properties: Record<string, { id: string; name?: string; type: string }>;
    }).properties;

    const mapped: Record<string, { id: string; name: string; type: string }> =
      {};
    const expectedNames = new Set([
      ...db.phaseAProperties.map((p) => p.name),
      ...db.phaseBRelations.map((p) => p.name),
    ]);

    for (const [name, prop] of Object.entries(props)) {
      mapped[name] = {
        id: prop.id,
        name: prop.name ?? name,
        type: prop.type,
      };
    }

    for (const expected of expectedNames) {
      if (!mapped[expected]) {
        throw new Error(`${db.title}: 必須プロパティ欠落 ${expected}`);
      }
    }

    databases[db.key] = {
      databaseId: ids.databaseId,
      dataSourceId: ids.dataSourceId,
      title: db.title,
      properties: mapped,
    };
  }

  return {
    schemaVersion: SETUP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    databases,
  };
}
