import type { Client } from "@notionhq/client";

import type { MastersCacheRow } from "@/types/database";
import type { PropertyIdMap } from "@/lib/notion/converters/customer";

/**
 * Notion営業マスタDB → masters_cache 同期コア。
 * Notionが正本。upsertのみで削除しない(冪等)。
 * server-only禁止(スクリプト・テストから使用)。
 */

type NotionProp = {
  id?: string;
  type: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  select?: { name?: string } | null;
  number?: number | null;
  checkbox?: boolean;
  relation?: Array<{ id: string }>;
};

type MasterPageLike = {
  id: string;
  in_trash?: boolean;
  last_edited_time?: string;
  properties: Record<string, NotionProp>;
};

export type MastersCacheUpsertRow = Omit<
  MastersCacheRow,
  "created_at" | "updated_at"
>;

export type MastersCacheStore = {
  upsert(rows: MastersCacheUpsertRow[]): Promise<void>;
};

/** schema snapshot(system_settings.notion_schema_snapshot)からmastersのプロパティマップを取り出す */
export function extractMastersPropertyMap(snapshot: unknown): PropertyIdMap {
  const value = snapshot as {
    databases?: {
      masters?: {
        properties?: Record<string, { id: string; name: string; type: string }>;
      };
    };
  } | null;
  const props = value?.databases?.masters?.properties;
  if (!props) {
    throw new Error("notion_schema_snapshot に masters プロパティがありません");
  }
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

function propByName(
  page: MasterPageLike,
  map: PropertyIdMap,
  name: string,
): NotionProp | undefined {
  const meta = map[name];
  if (!meta) {
    throw new Error(`スナップショットにプロパティがありません: ${name}`);
  }
  for (const prop of Object.values(page.properties)) {
    if (prop.id === meta.id) return prop;
  }
  return page.properties[name];
}

function plain(prop?: NotionProp): string {
  const parts = prop?.title ?? prop?.rich_text ?? [];
  return parts.map((t) => t.plain_text ?? "").join("");
}

/**
 * NotionマスタページをMasters cache行へ変換する。
 * semantic_tagsはカンマ区切りrich_text(setup仕様)を配列化。
 */
export function notionMasterPageToCacheRow(input: {
  page: MasterPageLike;
  propertiesByName: PropertyIdMap;
  nowIso?: string;
}): MastersCacheUpsertRow {
  const { page, propertiesByName: byName } = input;
  const name = plain(propByName(page, byName, "名称")).trim();
  if (!name) {
    throw new Error("マスタ名称が空です");
  }
  const masterType =
    propByName(page, byName, "マスタ種別")?.select?.name ?? null;
  if (!masterType) {
    throw new Error(`マスタ種別が未設定です: ${name}`);
  }
  const semanticKey = plain(propByName(page, byName, "semantic_key")).trim();
  const semanticTagsRaw = plain(
    propByName(page, byName, "semantic_tags"),
  ).trim();
  const semanticTags = semanticTagsRaw
    ? semanticTagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const externalId = plain(propByName(page, byName, "external_id")).trim();
  const applicableIds = (
    propByName(page, byName, "適用事業区分")?.relation ?? []
  ).map((r) => r.id);

  return {
    notion_page_id: page.id,
    external_id: externalId || null,
    content_hash: null,
    notion_last_edited_at: page.last_edited_time ?? null,
    sync_status: "synced",
    sync_error_message: null,
    last_synced_at: input.nowIso ?? new Date().toISOString(),
    master_type: masterType,
    name,
    semantic_key: semanticKey || null,
    semantic_tags: semanticTags,
    sort_order: propByName(page, byName, "表示順")?.number ?? null,
    color: propByName(page, byName, "色")?.select?.name ?? null,
    is_active: Boolean(propByName(page, byName, "有効")?.checkbox),
    applicable_category_ids: applicableIds,
  };
}

/**
 * 営業マスタDB全件をページングで取得してmasters_cacheへupsertする。
 * ゴミ箱内ページはスキップ。削除は行わない。
 */
export async function syncMastersCache(input: {
  notion: Client;
  mastersDataSourceId: string;
  propertiesByName: PropertyIdMap;
  store: MastersCacheStore;
  nowIso?: string;
}): Promise<{ upserted: number; skippedInTrash: number; byType: Record<string, number> }> {
  const rows: MastersCacheUpsertRow[] = [];
  let skippedInTrash = 0;
  let cursor: string | undefined;

  do {
    const res = (await input.notion.dataSources.query({
      data_source_id: input.mastersDataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    } as never)) as {
      results: MasterPageLike[];
      has_more: boolean;
      next_cursor: string | null;
    };
    for (const page of res.results) {
      if (page.in_trash) {
        skippedInTrash += 1;
        continue;
      }
      rows.push(
        notionMasterPageToCacheRow({
          page,
          propertiesByName: input.propertiesByName,
          nowIso: input.nowIso,
        }),
      );
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  if (rows.length > 0) {
    await input.store.upsert(rows);
  }

  const byType: Record<string, number> = {};
  for (const r of rows) {
    byType[r.master_type] = (byType[r.master_type] ?? 0) + 1;
  }
  return { upserted: rows.length, skippedInTrash, byType };
}
