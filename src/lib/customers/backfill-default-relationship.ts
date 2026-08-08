import "server-only";

import type { Client } from "@notionhq/client";

import type { CustomerWriteInput } from "@/lib/customers/types";
import {
  DEFAULT_ORGANIZATION_RELATIONSHIP_SEMANTIC_KEY,
} from "@/lib/organizations/relationship";
import { findRelationshipMasterPageId } from "@/lib/organizations/resolve-relationship-semantics";
import {
  notionPageToCustomer,
  type PropertyIdMap,
} from "@/lib/notion/converters/customer";
import { uuidV5 } from "@/lib/notion/ids";
import { createDefaultNotionClient } from "@/lib/notion/client";
import {
  customerUpdate,
  loadCustomerPropertyMap,
} from "@/lib/sync/write-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueJob } from "@/lib/jobs/queue";

export const BACKFILL_DEFAULT_RELATIONSHIP_KIND =
  "customer.backfill_default_relationship" as const;

const CHUNK_SIZE = 15;

/** system actor（recalculate 系の actor_name: "system" と同趣旨） */
const SYSTEM_ACTOR_ID = uuidV5("actor:system");
const SYSTEM_ACTOR_NAME = "system";

export type BackfillDefaultRelationshipPayload = {
  cursor?: string | null;
  processed?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
  chainId?: string;
};

export type BackfillDefaultRelationshipChunkResult = {
  done: boolean;
  cursor: string | null;
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  chunkSize: number;
};

type AdminClient = ReturnType<typeof createAdminClient>;

function domainToWriteInput(
  customer: {
    displayName: string;
    legalName: string | null;
    officeName: string | null;
    postalCode: string | null;
    prefecture: string | null;
    city: string | null;
    addressLine: string | null;
    phone: string | null;
    email: string | null;
    representativeName: string | null;
    website: string | null;
    businessCategoryPageIds: string[];
    tagPageIds: string[];
    relationshipPageIds: string[];
    salesStatusPageId: string | null;
    acquisitionRoutePageId: string | null;
    priorityPageId: string | null;
    staffPageIds: string[];
    relatedAccountPageIds: string[];
    isArchived: boolean;
  },
  relationshipPageIds: string[],
): CustomerWriteInput {
  return {
    displayName: customer.displayName,
    legalName: customer.legalName,
    officeName: customer.officeName,
    postalCode: customer.postalCode,
    prefecture: customer.prefecture,
    city: customer.city,
    addressLine: customer.addressLine,
    phone: customer.phone,
    email: customer.email,
    representativeName: customer.representativeName,
    website: customer.website,
    businessCategoryPageIds: customer.businessCategoryPageIds,
    tagPageIds: customer.tagPageIds,
    relationshipPageIds,
    salesStatusPageId: customer.salesStatusPageId,
    acquisitionRoutePageId: customer.acquisitionRoutePageId,
    priorityPageId: customer.priorityPageId,
    staffPageIds: customer.staffPageIds,
    relatedAccountPageIds: customer.relatedAccountPageIds,
    isArchived: customer.isArchived,
  };
}

async function loadCustomerFromNotion(input: {
  notion: Client;
  pageId: string;
  propertiesByName: PropertyIdMap;
}): Promise<{
  customer: Awaited<ReturnType<typeof notionPageToCustomer>>;
  lastEditedTime: string;
}> {
  const page = await input.notion.pages.retrieve({ page_id: input.pageId });
  const customer = await notionPageToCustomer({
    page: page as never,
    propertiesByName: input.propertiesByName,
    pager: {
      retrieve: async ({ page_id, property_id, start_cursor }) =>
        input.notion.pages.properties.retrieve({
          page_id,
          property_id,
          start_cursor,
        } as never) as never,
    },
  });
  const lastEditedTime =
    (page as { last_edited_time?: string }).last_edited_time ?? "";
  return { customer, lastEditedTime };
}

/** empty relationship_ids 候補件数（dry-run 用） */
export async function countEmptyRelationshipCandidates(
  admin: AdminClient = createAdminClient(),
): Promise<number> {
  const { count, error } = await admin
    .from("customer_index")
    .select("notion_page_id", { count: "exact", head: true })
    .filter("relationship_ids", "eq", "{}");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * 1チャンク分のデフォルト関係性バックフィル。
 * index 上 relationship_ids が空の顧客を対象にし、Notion 正本が空なら「顧客」を付与。
 */
export async function processBackfillDefaultRelationshipChunk(input: {
  payload?: BackfillDefaultRelationshipPayload;
  admin?: AdminClient;
  notion?: Client;
  propertiesByName?: PropertyIdMap;
  chunkSize?: number;
  enqueueNext?: boolean;
  createdBy?: string | null;
  /** false なら lease 喪失として中断 */
  heartbeat?: () => Promise<boolean>;
}): Promise<BackfillDefaultRelationshipChunkResult> {
  const admin = input.admin ?? createAdminClient();
  const notion = input.notion ?? createDefaultNotionClient();
  const propertiesByName =
    input.propertiesByName ?? (await loadCustomerPropertyMap(admin));
  const chunkSize = input.chunkSize ?? CHUNK_SIZE;
  const payload = input.payload ?? {};

  let processed = payload.processed ?? 0;
  let updated = payload.updated ?? 0;
  let skipped = payload.skipped ?? 0;
  let failed = payload.failed ?? 0;
  const cursor = payload.cursor ?? null;
  const chainId = payload.chainId ?? crypto.randomUUID();

  const customerMasterId = await findRelationshipMasterPageId(
    admin,
    DEFAULT_ORGANIZATION_RELATIONSHIP_SEMANTIC_KEY,
  );
  if (!customerMasterId) {
    throw new Error(
      `masters_cache に関係性 semantic_key=${DEFAULT_ORGANIZATION_RELATIONSHIP_SEMANTIC_KEY} がありません`,
    );
  }

  let query = admin
    .from("customer_index")
    .select("notion_page_id,external_id,relationship_ids")
    .filter("relationship_ids", "eq", "{}")
    .order("notion_page_id", { ascending: true })
    .limit(chunkSize);

  if (cursor) {
    query = query.gt("notion_page_id", cursor);
  }

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const candidates = (rows ?? []) as Array<{
    notion_page_id: string;
    external_id: string;
    relationship_ids: string[] | null;
  }>;

  let lastPageId: string | null = cursor;

  for (const row of candidates) {
    if (input.heartbeat) {
      const alive = await input.heartbeat();
      if (!alive) {
        throw new Error("lease_lost_during_chunk");
      }
    }

    lastPageId = row.notion_page_id;
    processed += 1;

    try {
      const { customer, lastEditedTime } = await loadCustomerFromNotion({
        notion,
        pageId: row.notion_page_id,
        propertiesByName,
      });

      if (customer.inTrash) {
        skipped += 1;
        continue;
      }

      if ((customer.relationshipPageIds ?? []).length > 0) {
        skipped += 1;
        continue;
      }

      const write = domainToWriteInput(customer, [customerMasterId]);
      const requestId = uuidV5(`rel-backfill:${row.notion_page_id}`);

      await customerUpdate({
        requestId,
        actorId: SYSTEM_ACTOR_ID,
        actorName: SYSTEM_ACTOR_NAME,
        notionPageId: row.notion_page_id,
        externalId: customer.externalId || row.external_id,
        expectedLastEditedTime: lastEditedTime,
        input: write,
      });
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  const hasMore = candidates.length >= chunkSize;
  const nextCursor = hasMore ? lastPageId : null;

  if (hasMore && input.enqueueNext !== false && nextCursor) {
    await enqueueJob({
      kind: BACKFILL_DEFAULT_RELATIONSHIP_KIND,
      payload: {
        cursor: nextCursor,
        processed,
        updated,
        skipped,
        failed,
        chainId,
      } satisfies BackfillDefaultRelationshipPayload,
      idempotencyKey: `${BACKFILL_DEFAULT_RELATIONSHIP_KIND}:${chainId}:${nextCursor}`,
      createdBy: input.createdBy ?? null,
      priority: 60,
    });
  }

  return {
    done: !hasMore,
    cursor: nextCursor,
    processed,
    updated,
    skipped,
    failed,
    chunkSize: candidates.length,
  };
}
