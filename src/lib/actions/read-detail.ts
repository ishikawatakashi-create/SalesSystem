import "server-only";

import type { Client } from "@notionhq/client";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { hashActionDomain } from "@/lib/actions/content-hash";
import type { ActionDetail } from "@/lib/actions/types";
import {
  notionPageToAction,
  type PropertyIdMap,
} from "@/lib/notion/converters/action";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { loadActionPropertyMap } from "@/lib/sync/action-write-pipeline";
import { ActionSyncError } from "@/lib/sync/errors";
import { classifyNotionError } from "@/lib/sync/notion-errors";
import { createAdminClient } from "@/lib/supabase/admin";

type CacheEntry = { expiresAt: number; value: ActionDetail };

const detailCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function getCached(pageId: string): ActionDetail | null {
  const hit = detailCache.get(pageId);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    detailCache.delete(pageId);
    return null;
  }
  return hit.value;
}

function setCached(pageId: string, value: ActionDetail) {
  detailCache.set(pageId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** テスト用 */
export function clearActionDetailCache() {
  detailCache.clear();
}

/**
 * 次回アクション詳細: Notion正本のみ。障害時にaction_indexで偽装しない。
 */
export async function getActionDetail(input: {
  notionPageId: string;
  notion?: Client;
  propertiesByName?: PropertyIdMap;
  skipCache?: boolean;
}): Promise<ActionDetail> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  if (!input.skipCache) {
    const cached = getCached(input.notionPageId);
    if (cached) return cached;
  }

  const admin = createAdminClient();
  const propertiesByName =
    input.propertiesByName ?? (await loadActionPropertyMap(admin));
  const notion = input.notion ?? createDefaultNotionClient();

  try {
    const page = await notion.pages.retrieve({
      page_id: input.notionPageId,
    });
    const action = await notionPageToAction({
      page: page as never,
      propertiesByName,
      pager: {
        retrieve: async ({ page_id, property_id, start_cursor }) =>
          notion.pages.properties.retrieve({
            page_id,
            property_id,
            start_cursor,
          } as never) as never,
      },
    });

    if (action.inTrash) {
      throw new ActionSyncError(
        "in_trash",
        "このアクションはゴミ箱にあります",
      );
    }

    const lastEditedTime =
      (page as { last_edited_time?: string }).last_edited_time ?? "";
    const createdTime =
      (page as { created_time?: string }).created_time ?? "";
    const detail: ActionDetail = {
      ...action,
      createdTime,
      lastEditedTime,
      contentHash: hashActionDomain(action),
    };
    setCached(input.notionPageId, detail);
    return detail;
  } catch (error) {
    if (error instanceof ActionSyncError) throw error;
    const klass = classifyNotionError(error);
    if (klass === "not_found") {
      throw new ActionSyncError(
        "not_found",
        "アクションページが見つかりません",
      );
    }
    throw new ActionSyncError(
      "notion_failed",
      "Notionからのアクション取得に失敗しました。一覧キャッシュを正本として表示しません",
      { class: klass },
    );
  }
}
