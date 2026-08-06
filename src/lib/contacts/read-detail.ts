import "server-only";

import type { Client } from "@notionhq/client";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { hashContactDomain } from "@/lib/contacts/content-hash";
import type { ContactDetail } from "@/lib/contacts/types";
import {
  notionPageToContact,
  type PropertyIdMap,
} from "@/lib/notion/converters/contact";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { loadContactPropertyMap } from "@/lib/sync/contact-write-pipeline";
import { ContactSyncError } from "@/lib/sync/errors";
import { classifyNotionError } from "@/lib/sync/notion-errors";
import { createAdminClient } from "@/lib/supabase/admin";

type CacheEntry = { expiresAt: number; value: ContactDetail };

const detailCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function getCached(pageId: string): ContactDetail | null {
  const hit = detailCache.get(pageId);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    detailCache.delete(pageId);
    return null;
  }
  return hit.value;
}

function setCached(pageId: string, value: ContactDetail) {
  detailCache.set(pageId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** テスト用 */
export function clearContactDetailCache() {
  detailCache.clear();
}

/**
 * 先方担当者詳細: Notion正本のみ。障害時にcontact_indexで偽装しない。
 */
export async function getContactDetail(input: {
  notionPageId: string;
  notion?: Client;
  propertiesByName?: PropertyIdMap;
  skipCache?: boolean;
}): Promise<ContactDetail> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  if (!input.skipCache) {
    const cached = getCached(input.notionPageId);
    if (cached) return cached;
  }

  const admin = createAdminClient();
  const propertiesByName =
    input.propertiesByName ?? (await loadContactPropertyMap(admin));
  const notion = input.notion ?? createDefaultNotionClient();

  try {
    const page = await notion.pages.retrieve({
      page_id: input.notionPageId,
    });
    const contact = await notionPageToContact({
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

    if (contact.inTrash) {
      throw new ContactSyncError(
        "in_trash",
        "この担当者はゴミ箱にあります",
      );
    }

    const lastEditedTime =
      (page as { last_edited_time?: string }).last_edited_time ?? "";
    const createdTime =
      (page as { created_time?: string }).created_time ?? "";
    const detail: ContactDetail = {
      ...contact,
      createdTime,
      lastEditedTime,
      contentHash: hashContactDomain(contact),
    };
    setCached(input.notionPageId, detail);
    return detail;
  } catch (error) {
    if (error instanceof ContactSyncError) throw error;
    const klass = classifyNotionError(error);
    if (klass === "not_found") {
      throw new ContactSyncError("not_found", "担当者ページが見つかりません");
    }
    throw new ContactSyncError(
      "notion_failed",
      "Notionからの担当者取得に失敗しました。一覧キャッシュを正本として表示しません",
      { class: klass },
    );
  }
}
