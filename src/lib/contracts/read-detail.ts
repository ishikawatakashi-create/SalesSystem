import "server-only";

import type { Client } from "@notionhq/client";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { hashContractDomain } from "@/lib/contracts/content-hash";
import type { ContractDetail } from "@/lib/contracts/types";
import {
  notionPageToContract,
  type PropertyIdMap,
} from "@/lib/notion/converters/contract";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { loadContractPropertyMap } from "@/lib/sync/contract-write-pipeline";
import { ContractSyncError } from "@/lib/sync/errors";
import { classifyNotionError } from "@/lib/sync/notion-errors";
import { createAdminClient } from "@/lib/supabase/admin";

type CacheEntry = { expiresAt: number; value: ContractDetail };

const detailCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function getCached(pageId: string): ContractDetail | null {
  const hit = detailCache.get(pageId);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    detailCache.delete(pageId);
    return null;
  }
  return hit.value;
}

function setCached(pageId: string, value: ContractDetail) {
  detailCache.set(pageId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** テスト用 */
export function clearContractDetailCache() {
  detailCache.clear();
}

/**
 * 契約詳細: Notion正本のみ。障害時にcontract_indexで偽装しない。
 */
export async function getContractDetail(input: {
  notionPageId: string;
  notion?: Client;
  propertiesByName?: PropertyIdMap;
  skipCache?: boolean;
}): Promise<ContractDetail> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  if (!input.skipCache) {
    const cached = getCached(input.notionPageId);
    if (cached) return cached;
  }

  const admin = createAdminClient();
  const propertiesByName =
    input.propertiesByName ?? (await loadContractPropertyMap(admin));
  const notion = input.notion ?? createDefaultNotionClient();

  try {
    const page = await notion.pages.retrieve({
      page_id: input.notionPageId,
    });
    const contract = await notionPageToContract({
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

    if (contract.inTrash) {
      throw new ContractSyncError("in_trash", "この契約はゴミ箱にあります");
    }

    const lastEditedTime =
      (page as { last_edited_time?: string }).last_edited_time ?? "";
    const createdTime =
      (page as { created_time?: string }).created_time ?? "";
    const detail: ContractDetail = {
      ...contract,
      createdTime,
      lastEditedTime,
      contentHash: hashContractDomain(contract),
    };
    setCached(input.notionPageId, detail);
    return detail;
  } catch (error) {
    if (error instanceof ContractSyncError) throw error;
    const klass = classifyNotionError(error);
    if (klass === "not_found") {
      throw new ContractSyncError("not_found", "契約ページが見つかりません");
    }
    throw new ContractSyncError(
      "notion_failed",
      "Notionからの契約取得に失敗しました。一覧キャッシュを正本として表示しません",
      { class: klass },
    );
  }
}
