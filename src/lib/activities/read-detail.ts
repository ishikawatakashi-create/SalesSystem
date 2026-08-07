import "server-only";

import type { Client } from "@notionhq/client";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { hashActivityDomain } from "@/lib/activities/content-hash";
import type { ActivityDetail } from "@/lib/activities/types";
import {
  notionPageToActivity,
  type PropertyIdMap,
} from "@/lib/notion/converters/activity";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { listAllChildBlocks } from "@/lib/sync/activity-body";
import { loadActivityPropertyMap } from "@/lib/sync/activity-write-pipeline";
import { ActivitySyncError } from "@/lib/sync/errors";
import { classifyNotionError } from "@/lib/sync/notion-errors";
import { createAdminClient } from "@/lib/supabase/admin";

type CacheEntry = { expiresAt: number; value: ActivityDetail };

const detailCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function getCached(pageId: string): ActivityDetail | null {
  const hit = detailCache.get(pageId);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    detailCache.delete(pageId);
    return null;
  }
  return hit.value;
}

function setCached(pageId: string, value: ActivityDetail) {
  detailCache.set(pageId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** テスト用 */
export function clearActivityDetailCache() {
  detailCache.clear();
}

/**
 * 対応履歴詳細: Notion正本のみ。障害時にactivity_indexで偽装しない。
 */
export async function getActivityDetail(input: {
  notionPageId: string;
  notion?: Client;
  propertiesByName?: PropertyIdMap;
  skipCache?: boolean;
}): Promise<ActivityDetail> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  if (!input.skipCache) {
    const cached = getCached(input.notionPageId);
    if (cached) return cached;
  }

  const admin = createAdminClient();
  const propertiesByName =
    input.propertiesByName ?? (await loadActivityPropertyMap(admin));
  const notion = input.notion ?? createDefaultNotionClient();

  try {
    const page = await notion.pages.retrieve({
      page_id: input.notionPageId,
    });
    const blocks = await listAllChildBlocks(notion, input.notionPageId);
    const activity = await notionPageToActivity({
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
      blocks,
    });

    if (activity.inTrash) {
      throw new ActivitySyncError(
        "in_trash",
        "この対応履歴はゴミ箱にあります",
      );
    }

    const lastEditedTime =
      (page as { last_edited_time?: string }).last_edited_time ?? "";
    const createdTime =
      (page as { created_time?: string }).created_time ?? "";
    const detail: ActivityDetail = {
      ...activity,
      createdTime,
      lastEditedTime,
      contentHash: hashActivityDomain(activity),
    };
    setCached(input.notionPageId, detail);
    return detail;
  } catch (error) {
    if (error instanceof ActivitySyncError) throw error;
    const klass = classifyNotionError(error);
    if (klass === "not_found") {
      throw new ActivitySyncError(
        "not_found",
        "対応履歴ページが見つかりません",
      );
    }
    throw new ActivitySyncError(
      "notion_failed",
      "Notionからの対応履歴取得に失敗しました。一覧キャッシュを正本として表示しません",
      { class: klass },
    );
  }
}
