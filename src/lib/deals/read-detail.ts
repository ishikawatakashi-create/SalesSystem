import "server-only";

import type { Client } from "@notionhq/client";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { hashDealDomain } from "@/lib/deals/content-hash";
import type { DealDetail } from "@/lib/deals/types";
import {
  notionPageToDeal,
  type PropertyIdMap,
} from "@/lib/notion/converters/deal";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { loadDealPropertyMap } from "@/lib/sync/deal-write-pipeline";
import { DealSyncError } from "@/lib/sync/errors";
import { classifyNotionError } from "@/lib/sync/notion-errors";
import { createAdminClient } from "@/lib/supabase/admin";

type CacheEntry = { expiresAt: number; value: DealDetail };

const detailCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function getCached(pageId: string): DealDetail | null {
  const hit = detailCache.get(pageId);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    detailCache.delete(pageId);
    return null;
  }
  return hit.value;
}

function setCached(pageId: string, value: DealDetail) {
  detailCache.set(pageId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** テスト用 */
export function clearDealDetailCache() {
  detailCache.clear();
}

/**
 * 案件詳細: Notion正本のみ。障害時にdeal_indexで偽装しない。
 */
export async function getDealDetail(input: {
  notionPageId: string;
  notion?: Client;
  propertiesByName?: PropertyIdMap;
  skipCache?: boolean;
}): Promise<DealDetail> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  if (!input.skipCache) {
    const cached = getCached(input.notionPageId);
    if (cached) return cached;
  }

  const admin = createAdminClient();
  const propertiesByName =
    input.propertiesByName ?? (await loadDealPropertyMap(admin));
  const notion = input.notion ?? createDefaultNotionClient();

  try {
    const page = await notion.pages.retrieve({
      page_id: input.notionPageId,
    });
    const deal = await notionPageToDeal({
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

    if (deal.inTrash) {
      throw new DealSyncError("in_trash", "この案件はゴミ箱にあります");
    }

    const lastEditedTime =
      (page as { last_edited_time?: string }).last_edited_time ?? "";
    const createdTime =
      (page as { created_time?: string }).created_time ?? "";
    const detail: DealDetail = {
      ...deal,
      createdTime,
      lastEditedTime,
      contentHash: hashDealDomain(deal),
    };
    setCached(input.notionPageId, detail);
    return detail;
  } catch (error) {
    if (error instanceof DealSyncError) throw error;
    const klass = classifyNotionError(error);
    if (klass === "not_found") {
      throw new DealSyncError("not_found", "案件ページが見つかりません");
    }
    throw new DealSyncError(
      "notion_failed",
      "Notionからの案件取得に失敗しました。一覧キャッシュを正本として表示しません",
      { class: klass },
    );
  }
}
