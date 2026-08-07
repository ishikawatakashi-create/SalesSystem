import "server-only";

import type { Client } from "@notionhq/client";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { hashComplaintDomain } from "@/lib/complaints/content-hash";
import type { ComplaintDetail } from "@/lib/complaints/types";
import {
  notionPageToComplaint,
  type PropertyIdMap,
} from "@/lib/notion/converters/complaint";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { listAllChildBlocks } from "@/lib/sync/activity-body";
import { loadComplaintPropertyMap } from "@/lib/sync/complaint-write-pipeline";
import { ComplaintSyncError } from "@/lib/sync/errors";
import { classifyNotionError } from "@/lib/sync/notion-errors";
import { createAdminClient } from "@/lib/supabase/admin";

type CacheEntry = { expiresAt: number; value: ComplaintDetail };

const detailCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function getCached(pageId: string): ComplaintDetail | null {
  const hit = detailCache.get(pageId);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    detailCache.delete(pageId);
    return null;
  }
  return hit.value;
}

function setCached(pageId: string, value: ComplaintDetail) {
  detailCache.set(pageId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** テスト用 */
export function clearComplaintDetailCache() {
  detailCache.clear();
}

/**
 * クレーム詳細: Notion正本のみ。障害時にcomplaint_indexで偽装しない。
 */
export async function getComplaintDetail(input: {
  notionPageId: string;
  notion?: Client;
  propertiesByName?: PropertyIdMap;
  skipCache?: boolean;
}): Promise<ComplaintDetail> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  if (!input.skipCache) {
    const cached = getCached(input.notionPageId);
    if (cached) return cached;
  }

  const admin = createAdminClient();
  const propertiesByName =
    input.propertiesByName ?? (await loadComplaintPropertyMap(admin));
  const notion = input.notion ?? createDefaultNotionClient();

  try {
    const page = await notion.pages.retrieve({
      page_id: input.notionPageId,
    });
    const blocks = await listAllChildBlocks(notion, input.notionPageId);
    const complaint = await notionPageToComplaint({
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

    if (complaint.inTrash) {
      throw new ComplaintSyncError(
        "in_trash",
        "このクレームはゴミ箱にあります",
      );
    }

    const lastEditedTime =
      (page as { last_edited_time?: string }).last_edited_time ?? "";
    const createdTime =
      (page as { created_time?: string }).created_time ?? "";
    const detail: ComplaintDetail = {
      ...complaint,
      createdTime,
      lastEditedTime,
      contentHash: hashComplaintDomain(complaint),
    };
    setCached(input.notionPageId, detail);
    return detail;
  } catch (error) {
    if (error instanceof ComplaintSyncError) throw error;
    const klass = classifyNotionError(error);
    if (klass === "not_found") {
      throw new ComplaintSyncError(
        "not_found",
        "クレームページが見つかりません",
      );
    }
    throw new ComplaintSyncError(
      "notion_failed",
      "Notionからのクレーム取得に失敗しました。一覧キャッシュを正本として表示しません",
      { class: klass },
    );
  }
}
