/**
 * Notion setup applyエンジン。
 * planモードでは呼ばない。--apply時のみ使用。
 * 部分実行再開のためsystem_settingsへ状態を保存する。
 */

import type { Client } from "@notionhq/client";

import {
  DATABASES,
  RELATION_PHASE_ORDER,
  type NotionDbKey,
} from "@/lib/notion/schema/databases";
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
  /** 実行記録(トークン・ページIDは含めない) */
  notes?: string[];
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
    notes: [
      "2026-08-06: read-only preflightの初回insertプローブが無題ページを1件誤作成。ゴミ箱へ移動済み。ゴミ箱内ページは既存DB/setup対象として扱わない。",
    ],
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

  // Phase A — RELATION_PHASE_ORDERで作成(依存関係の見通し用。全完了後にPhase B)
  state.phase = "a";
  for (const key of RELATION_PHASE_ORDER) {
    const db = DATABASES.find((d) => d.key === key)!;
    const current = state.databases[db.key];
    if (current.databaseId && current.dataSourceId) continue;

    const created = await input.client.databases.create({
      parent: { type: "page_id", page_id: input.parentPageId },
      title: [{ type: "text", text: { content: db.title } }],
      initial_data_source: {
        properties: toNotionProperties(db.phaseAProperties),
      },
    } as never);

    const databaseId = (created as { id: string }).id;
    const verified = await input.client.databases.retrieve({
      database_id: databaseId,
    });
    if ((verified as { in_trash?: boolean }).in_trash) {
      throw new Error(`${db.title}: 作成直後にin_trash=true`);
    }
    const dataSources = (verified as { data_sources?: Array<{ id: string }> })
      .data_sources;
    const dataSourceId = dataSources?.[0]?.id;
    if (!dataSourceId) {
      throw new Error(`${db.title}: data_source_idを取得できませんでした`);
    }
    if (dataSourceId === databaseId) {
      throw new Error(
        `${db.title}: database_idとdata_source_idが同一です(混同の疑い)`,
      );
    }

    // data source側でも必須プロパティを再確認
    const ds = await input.client.dataSources.retrieve({
      data_source_id: dataSourceId,
    });
    const props = (ds as { properties: Record<string, { type: string }> })
      .properties;
    for (const required of ["external_id", "作成日時", "更新日時"]) {
      if (!props[required]) {
        throw new Error(`${db.title}: 作成直後に ${required} が欠落`);
      }
    }

    state.databases[db.key] = {
      title: db.title,
      databaseId,
      dataSourceId,
    };
    state.updatedAt = new Date().toISOString();
    await input.store.save(state);
  }

  // Phase B relations
  // dual=true → dual_property(双方向)。singleは「単一ページ制限」の設計意図で、
  // Notion APIの single_property(片方向)とは別概念。API種別は dual 優先。
  state.phase = "b";
  for (const key of RELATION_PHASE_ORDER) {
    const db = DATABASES.find((d) => d.key === key)!;
    const dsId = state.databases[key].dataSourceId!;
    const retrieved = await input.client.dataSources.retrieve({
      data_source_id: dsId,
    });
    const existingProps = (
      retrieved as {
        properties: Record<
          string,
          {
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

    for (const prop of db.phaseBRelations) {
      if (prop.type !== "relation") continue;
      const targetDs = state.databases[prop.target].dataSourceId;
      if (!targetDs) {
        throw new Error(`relation対象 ${prop.target} のdata_source_idが未確定`);
      }

      const expectedKind = prop.dual ? "dual_property" : "single_property";
      const existing = existingProps[prop.name];
      if (existing) {
        if (existing.type !== "relation") {
          throw new Error(
            `${db.title}.${prop.name}: 既存プロパティがrelationではありません`,
          );
        }
        continue;
      }

      await input.client.dataSources.update({
        data_source_id: dsId,
        properties: {
          [prop.name]: {
            type: "relation",
            relation: {
              data_source_id: targetDs,
              ...(prop.dual
                ? { type: "dual_property", dual_property: {} }
                : { type: "single_property", single_property: {} }),
            },
          },
        },
      } as never);

      const after = await input.client.dataSources.retrieve({
        data_source_id: dsId,
      });
      const afterProp = (
        after as {
          properties: Record<
            string,
            {
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
      ).properties[prop.name];
      if (!afterProp || afterProp.type !== "relation") {
        throw new Error(`${db.title}.${prop.name}: relation作成後に検証失敗`);
      }
      if (afterProp.relation?.data_source_id !== targetDs) {
        throw new Error(
          `${db.title}.${prop.name}: 参照先data_source_idが不一致`,
        );
      }
      const actualKind =
        afterProp.relation?.type ??
        (afterProp.relation?.dual_property
          ? "dual_property"
          : afterProp.relation?.single_property
            ? "single_property"
            : "unknown");
      if (actualKind !== expectedKind) {
        throw new Error(
          `${db.title}.${prop.name}: relation種別が不一致 expected=${expectedKind} actual=${actualKind}`,
        );
      }
      existingProps[prop.name] = afterProp;
    }
    state.updatedAt = new Date().toISOString();
    await input.store.save(state);
  }

  // Phase C masters (idempotent by external_id query)
  state.phase = "c";
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

    const listed = await input.client.views.list({
      database_id: databaseId,
      data_source_id: dataSourceId,
    });
    // list results may be id-only; retrieve to match by name
    let existingId: string | undefined;
    for (const ref of listed.results) {
      const detail = await input.client.views.retrieve({ view_id: ref.id });
      const name = (detail as { name?: string }).name;
      if (name === view.name) {
        existingId = ref.id;
        break;
      }
    }
    if (existingId) {
      state.views[view.key] = {
        viewId: existingId,
        name: view.name,
        databaseKey: view.databaseKey,
      };
      await input.store.save(state);
      continue;
    }

    const ds = await input.client.dataSources.retrieve({
      data_source_id: dataSourceId,
    });
    const props = (
      ds as { properties: Record<string, { id: string; type: string }> }
    ).properties;

    const payload: Record<string, unknown> = {
      database_id: databaseId,
      data_source_id: dataSourceId,
      name: view.name,
      type: view.type,
    };

    // 可能な範囲でfilter/sortを付与。マスタページID依存フィルタは未設定のままMANUAL。
    if (view.key === "customers_all") {
      payload.filter = { property: "アーカイブ", checkbox: { equals: false } };
      payload.sorts = [
        { property: "最終対応日", direction: "descending" },
      ];
    } else if (view.key === "activities_latest") {
      payload.sorts = [
        { property: "対応日時", direction: "descending" },
      ];
    } else if (view.key === "customers_by_status") {
      const groupProp = props["営業ステータス"];
      if (!groupProp) {
        throw new Error("営業ステータスプロパティが無くboard作成不可");
      }
      payload.configuration = {
        type: "board",
        group_by: {
          type: "relation",
          property_id: groupProp.id,
          sort: { type: "manual" },
          hide_empty_groups: false,
        },
      };
    } else if (view.key === "actions_due") {
      payload.sorts = [{ property: "期限", direction: "ascending" }];
    } else if (view.key === "complaints_open") {
      payload.sorts = [{ property: "対応期限", direction: "ascending" }];
    } else if (view.key === "contracts_active") {
      payload.sorts = [{ property: "契約終了日", direction: "ascending" }];
    }

    const created = await input.client.views.create(payload as never);
    state.views[view.key] = {
      viewId: (created as { id: string }).id,
      name: view.name,
      databaseKey: view.databaseKey,
    };
    if (view.manualSetupNotes?.length) {
      state.notes = [
        ...(state.notes ?? []),
        ...view.manualSetupNotes.map((n) => `view:${view.key} MANUAL — ${n}`),
      ];
    }
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
