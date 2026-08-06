import "server-only";

import type { Client } from "@notionhq/client";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { hashCustomerDomain } from "@/lib/customers/content-hash";
import type { CustomerDetail } from "@/lib/customers/types";
import {
  notionPageToCustomer,
  type PropertyIdMap,
} from "@/lib/notion/converters/customer";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { loadCustomerPropertyMap } from "@/lib/sync/write-pipeline";
import { CustomerSyncError } from "@/lib/sync/errors";
import { classifyNotionError } from "@/lib/sync/notion-errors";
import { createAdminClient } from "@/lib/supabase/admin";

type CacheEntry = { expiresAt: number; value: CustomerDetail };

const detailCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function getCached(pageId: string): CustomerDetail | null {
  const hit = detailCache.get(pageId);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    detailCache.delete(pageId);
    return null;
  }
  return hit.value;
}

function setCached(pageId: string, value: CustomerDetail) {
  detailCache.set(pageId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** テスト用 */
export function clearCustomerDetailCache() {
  detailCache.clear();
}

/**
 * 顧客詳細: Notion正本のみ。障害時にcustomer_indexで偽装しない。
 */
export async function getCustomerDetail(input: {
  notionPageId: string;
  notion?: Client;
  propertiesByName?: PropertyIdMap;
  skipCache?: boolean;
}): Promise<CustomerDetail> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  if (!input.skipCache) {
    const cached = getCached(input.notionPageId);
    if (cached) return cached;
  }

  const admin = createAdminClient();
  const propertiesByName =
    input.propertiesByName ?? (await loadCustomerPropertyMap(admin));
  const notion = input.notion ?? createDefaultNotionClient();

  try {
    const page = await notion.pages.retrieve({
      page_id: input.notionPageId,
    });
    const customer = await notionPageToCustomer({
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

    if (customer.inTrash) {
      throw new CustomerSyncError(
        "in_trash",
        "この顧客はゴミ箱にあります",
      );
    }

    const lastEditedTime =
      (page as { last_edited_time?: string }).last_edited_time ?? "";
    const createdTime =
      (page as { created_time?: string }).created_time ?? "";
    const detail: CustomerDetail = {
      ...customer,
      createdTime,
      lastEditedTime,
      contentHash: hashCustomerDomain(customer),
    };
    setCached(input.notionPageId, detail);
    return detail;
  } catch (error) {
    if (error instanceof CustomerSyncError) throw error;
    const klass = classifyNotionError(error);
    if (klass === "not_found") {
      throw new CustomerSyncError("not_found", "顧客ページが見つかりません");
    }
    // Notion障害時にindexを正本として返さない
    throw new CustomerSyncError(
      "notion_failed",
      "Notionからの顧客取得に失敗しました。一覧キャッシュを正本として表示しません",
      { class: klass },
    );
  }
}
