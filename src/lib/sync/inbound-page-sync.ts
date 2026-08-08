import "server-only";

import type { Client } from "@notionhq/client";

import { hashActionDomain } from "@/lib/actions/content-hash";
import { actionDomainToIndexRow } from "@/lib/actions/index-mapper";
import { requestNextActionRecalc } from "@/lib/actions/request-rollup";
import { hashActivityDomain } from "@/lib/activities/content-hash";
import { activityDomainToIndexRow } from "@/lib/activities/index-mapper";
import { requestCustomerLatestActivityRecalc } from "@/lib/activities/request-rollup";
import { hashComplaintDomain } from "@/lib/complaints/content-hash";
import { complaintDomainToIndexRow } from "@/lib/complaints/index-mapper";
import { hashContactDomain } from "@/lib/contacts/content-hash";
import { contactDomainToIndexRow } from "@/lib/contacts/index-mapper";
import { hashContractDomain } from "@/lib/contracts/content-hash";
import { contractDomainToIndexRow } from "@/lib/contracts/index-mapper";
import { hashCustomerDomain } from "@/lib/customers/content-hash";
import { customerDomainToIndexRow } from "@/lib/customers/index-mapper";
import { hashDealDomain } from "@/lib/deals/content-hash";
import { dealDomainToIndexRow } from "@/lib/deals/index-mapper";
import { requestCustomerExpectedAmountRecalc } from "@/lib/deals/request-recalc";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { notionPageToAction } from "@/lib/notion/converters/action";
import { notionPageToActivity } from "@/lib/notion/converters/activity";
import { notionPageToComplaint } from "@/lib/notion/converters/complaint";
import { notionPageToContact } from "@/lib/notion/converters/contact";
import { notionPageToContract } from "@/lib/notion/converters/contract";
import { notionPageToCustomer } from "@/lib/notion/converters/customer";
import { notionPageToDeal } from "@/lib/notion/converters/deal";
import {
  extractMastersPropertyMap,
  notionMasterPageToCacheRow,
} from "@/lib/masters/sync-core";
import { SCHEMA_SNAPSHOT_KEY } from "@/lib/notion/setup/apply";
import { listAllChildBlocks } from "@/lib/sync/activity-body";
import {
  ALL_INDEX_TABLES,
  extractDataSourceId,
  INDEX_TABLE_BY_ENTITY,
  loadDataSourceEnvMap,
  resolveEntityByDataSourceId,
  type IndexTableName,
  type SyncEntityKey,
} from "@/lib/sync/ds-routing";
import { NotionHttpError } from "@/lib/notion/client-core";
import { classifyNotionError } from "@/lib/sync/notion-errors";
import { loadActionPropertyMap } from "@/lib/sync/action-write-pipeline";
import { loadActivityPropertyMap } from "@/lib/sync/activity-write-pipeline";
import { loadComplaintPropertyMap } from "@/lib/sync/complaint-write-pipeline";
import { loadContactPropertyMap } from "@/lib/sync/contact-write-pipeline";
import { loadContractPropertyMap } from "@/lib/sync/contract-write-pipeline";
import { loadDealPropertyMap } from "@/lib/sync/deal-write-pipeline";
import { loadCustomerPropertyMap } from "@/lib/sync/write-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type InboundSyncResult =
  | { status: "synced"; entity: SyncEntityKey; skipped?: boolean; reason?: string }
  | { status: "delete_pending"; entity: SyncEntityKey | "unknown" }
  | { status: "unknown_ds"; pageId: string }
  | { status: "warning"; message: string };

function defaultPager(notion: Client) {
  return {
    retrieve: async ({
      page_id,
      property_id,
      start_cursor,
    }: {
      page_id: string;
      property_id: string;
      start_cursor?: string;
    }) =>
      notion.pages.properties.retrieve({
        page_id,
        property_id,
        start_cursor,
      } as never) as never,
  };
}

function pageLastEdited(page: { last_edited_time?: string }): string | null {
  return page.last_edited_time ?? null;
}

function isAlreadySynced(
  indexLastEdited: string | null | undefined,
  pageLastEdited: string | null,
  indexHash: string | null | undefined,
  contentHash: string,
): boolean {
  if (indexLastEdited && pageLastEdited && indexLastEdited >= pageLastEdited) {
    return true;
  }
  if (indexHash && indexHash === contentHash) return true;
  return false;
}

/** delete_pending / undeleted 等はスキップせず必ず synced へ戻す */
function shouldSkipUnchanged(input: {
  existing: { row: Record<string, unknown> } | null | undefined;
  lastEdited: string | null;
  contentHash: string;
  eventType?: string;
}): boolean {
  if (!input.existing) return false;
  const status = input.existing.row.sync_status as string | undefined;
  if (status === "delete_pending" || status === "error") return false;
  if (
    input.eventType === "page.undeleted" ||
    input.eventType === "page.created"
  ) {
    return false;
  }
  return isAlreadySynced(
    input.existing.row.notion_last_edited_at as string | null,
    input.lastEdited,
    input.existing.row.content_hash as string | null,
    input.contentHash,
  );
}

async function resolveStaffUserIds(
  admin: Admin,
  staffPageIds: string[],
): Promise<string[]> {
  if (staffPageIds.length === 0) return [];
  const { data, error } = await admin
    .from("app_users")
    .select("id,notion_staff_page_id")
    .in("notion_staff_page_id", staffPageIds);
  if (error) throw new Error(error.message);
  const map = new Map(
    (data ?? []).map((u) => [u.notion_staff_page_id as string, u.id as string]),
  );
  return staffPageIds.map((id) => map.get(id)).filter((id): id is string => Boolean(id));
}

async function resolveAssigneeUserId(
  admin: Admin,
  staffPageId: string | null,
): Promise<string | null> {
  if (!staffPageId) return null;
  const { data, error } = await admin
    .from("app_users")
    .select("id")
    .eq("notion_staff_page_id", staffPageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.id as string | undefined) ?? null;
}

async function resolveStatusSemantic(
  admin: Admin,
  statusPageId: string | null,
  masterType: string,
): Promise<string | null> {
  if (!statusPageId) return null;
  const { data, error } = await admin
    .from("masters_cache")
    .select("semantic_key,master_type")
    .eq("notion_page_id", statusPageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.master_type !== masterType) return null;
  return (data.semantic_key as string | null) ?? null;
}

async function getCustomerDisplayName(
  admin: Admin,
  customerPageId: string | null,
): Promise<string | null> {
  if (!customerPageId) return null;
  const { data, error } = await admin
    .from("customer_index")
    .select("display_name")
    .eq("notion_page_id", customerPageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.display_name as string | undefined) ?? null;
}

async function getDealTitle(
  admin: Admin,
  dealPageId: string | null,
): Promise<string | null> {
  if (!dealPageId) return null;
  const { data, error } = await admin
    .from("deal_index")
    .select("title")
    .eq("notion_page_id", dealPageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.title as string | undefined) ?? null;
}

async function insertAudit(input: {
  admin: Admin;
  entityType: string;
  notionPageId: string;
  changedFields: Record<string, unknown>;
}): Promise<void> {
  const { error } = await input.admin.from("audit_logs").insert({
    actor_id: null,
    actor_name: null,
    action: "sync.notion_change",
    entity_type: input.entityType,
    notion_page_id: input.notionPageId,
    changed_fields: input.changedFields,
    operation_source: "notion_webhook",
    request_id: null,
  } as never);
  if (error) throw new Error(error.message);
}

async function insertSyncWarning(input: {
  admin: Admin;
  stage: string;
  entityType: string | null;
  notionPageId: string | null;
  message: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await input.admin.from("sync_errors").insert({
    stage: input.stage,
    entity_type: input.entityType,
    notion_page_id: input.notionPageId,
    external_id: null,
    message: input.message,
    detail: input.detail ?? {},
  } as never);
}

/** index テーブルを横断して notion_page_id の所在を探す */
export async function findIndexRowByPageId(
  admin: Admin,
  pageId: string,
): Promise<{ table: IndexTableName; entity: SyncEntityKey; row: Record<string, unknown> } | null> {
  for (const table of ALL_INDEX_TABLES) {
    const { data, error } = await admin
      .from(table)
      .select("notion_page_id,notion_last_edited_at,content_hash,sync_status,external_id")
      .eq("notion_page_id", pageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) continue;
    const entity =
      table === "masters_cache"
        ? ("masters" as const)
        : (Object.entries(INDEX_TABLE_BY_ENTITY).find(
            ([, t]) => t === table,
          )?.[0] as Exclude<SyncEntityKey, "masters">);
    return {
      table,
      entity,
      row: data as Record<string, unknown>,
    };
  }
  return null;
}

export async function markDeletePending(input: {
  admin?: Admin;
  pageId: string;
}): Promise<InboundSyncResult> {
  const admin = input.admin ?? createAdminClient();
  const found = await findIndexRowByPageId(admin, input.pageId);
  if (!found) {
    await insertSyncWarning({
      admin,
      stage: "webhook_delete",
      entityType: null,
      notionPageId: input.pageId,
      message: "delete event for unknown page (no index row)",
    });
    return { status: "delete_pending", entity: "unknown" };
  }
  const { error } = await admin
    .from(found.table)
    .update({
      sync_status: "delete_pending",
      sync_error_message: "notion page deleted (in_trash)",
    } as never)
    .eq("notion_page_id", input.pageId);
  if (error) throw new Error(error.message);

  await insertAudit({
    admin,
    entityType: found.entity,
    notionPageId: input.pageId,
    changedFields: {
      sync_status: { after: "delete_pending" },
      summary: "page.deleted → delete_pending",
    },
  });

  return { status: "delete_pending", entity: found.entity };
}

async function replaceCustomerRelations(
  admin: Admin,
  fromPageId: string,
  toPageIds: string[],
): Promise<void> {
  const { error: delError } = await admin
    .from("customer_relations")
    .delete()
    .eq("from_page_id", fromPageId);
  if (delError) throw new Error(delError.message);
  if (toPageIds.length === 0) return;
  const { error } = await admin.from("customer_relations").insert(
    toPageIds.map((to) => ({
      from_page_id: fromPageId,
      to_page_id: to,
    })) as never,
  );
  if (error) throw new Error(error.message);
}

/**
 * Notion ページを再取得して該当 index へ upsert。
 * 自書込スキップ・audit・rollup 要求まで行う。
 */
export async function syncPageFromNotion(input: {
  pageId: string;
  notion?: Client;
  admin?: Admin;
  /** webhook entity / payload から得たヒント */
  hintedDataSourceId?: string | null;
  eventType?: string;
}): Promise<InboundSyncResult> {
  const admin = input.admin ?? createAdminClient();
  const notion = input.notion ?? createDefaultNotionClient();
  const envMap = loadDataSourceEnvMap();

  let page: {
    id: string;
    in_trash?: boolean;
    last_edited_time?: string;
    parent?: { type?: string; data_source_id?: string };
    properties: Record<string, unknown>;
  };

  try {
    page = (await notion.pages.retrieve({
      page_id: input.pageId,
    })) as typeof page;
  } catch (error) {
    const klass = classifyNotionError(error);
    if (klass === "not_found") {
      return markDeletePending({ admin, pageId: input.pageId });
    }
    throw error;
  }

  if (page.in_trash) {
    return markDeletePending({ admin, pageId: input.pageId });
  }

  const dataSourceId = extractDataSourceId({
    pageParent: page.parent,
    payloadDataSourceId: input.hintedDataSourceId,
  });
  let entity = resolveEntityByDataSourceId(dataSourceId, envMap);

  if (!entity) {
    const existing = await findIndexRowByPageId(admin, input.pageId);
    entity = existing?.entity ?? null;
  }

  if (!entity) {
    await insertSyncWarning({
      admin,
      stage: "webhook_unknown_ds",
      entityType: null,
      notionPageId: input.pageId,
      message: "unknown data source for page; skipped",
      detail: { dataSourceId },
    });
    return { status: "unknown_ds", pageId: input.pageId };
  }

  const lastEdited = pageLastEdited(page);
  const pager = defaultPager(notion);
  const existing = await findIndexRowByPageId(admin, input.pageId);

  if (entity === "masters") {
    const { data: snapRow, error: snapError } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", SCHEMA_SNAPSHOT_KEY)
      .maybeSingle();
    if (snapError) throw new Error(snapError.message);
    const propertiesByName = extractMastersPropertyMap(snapRow?.value);
    const row = notionMasterPageToCacheRow({
      page: page as never,
      propertiesByName,
    });
    if (
      shouldSkipUnchanged({
        existing,
        lastEdited,
        contentHash: row.content_hash ?? "",
        eventType: input.eventType,
      })
    ) {
      return {
        status: "synced",
        entity,
        skipped: true,
        reason: "self_write_or_unchanged",
      };
    }
    const { error } = await admin.from("masters_cache").upsert(row as never);
    if (error) throw new Error(error.message);
    await insertAudit({
      admin,
      entityType: "masters",
      notionPageId: input.pageId,
      changedFields: {
        summary: input.eventType ?? "page.sync",
        external_id: row.external_id,
        name: row.name,
        master_type: row.master_type,
      },
    });
    return { status: "synced", entity };
  }

  if (entity === "customers") {
    const propertiesByName = await loadCustomerPropertyMap(admin);
    const customer = await notionPageToCustomer({
      page: page as never,
      propertiesByName,
      pager,
    });
    const contentHash = hashCustomerDomain(customer);
    if (
      shouldSkipUnchanged({
        existing,
        lastEdited,
        contentHash,
        eventType: input.eventType,
      })
    ) {
      return {
        status: "synced",
        entity,
        skipped: true,
        reason: "self_write_or_unchanged",
      };
    }
    const staffUserIds = await resolveStaffUserIds(admin, customer.staffPageIds);
    const { resolveRelationshipSemanticKeys } = await import(
      "@/lib/organizations/resolve-relationship-semantics"
    );
    const relationshipSemanticKeys = await resolveRelationshipSemanticKeys(
      admin,
      customer.relationshipPageIds ?? [],
    );
    const row = customerDomainToIndexRow({
      customer,
      staffUserIds,
      relationshipSemanticKeys,
      contentHash,
      notionLastEditedAt: lastEdited,
      syncStatus: "synced",
    });
    const { error } = await admin.from("customer_index").upsert(row as never);
    if (error) throw new Error(error.message);
    await replaceCustomerRelations(
      admin,
      customer.notionPageId,
      customer.relatedAccountPageIds,
    );
    await insertAudit({
      admin,
      entityType: "customers",
      notionPageId: input.pageId,
      changedFields: {
        summary: input.eventType ?? "page.sync",
        external_id: customer.externalId,
        content_hash: contentHash,
        notion_last_edited_at: lastEdited,
      },
    });
    return { status: "synced", entity };
  }

  if (entity === "contacts") {
    const propertiesByName = await loadContactPropertyMap(admin);
    const contact = await notionPageToContact({
      page: page as never,
      propertiesByName,
      pager,
    });
    const contentHash = hashContactDomain(contact);
    if (
      shouldSkipUnchanged({
        existing,
        lastEdited,
        contentHash,
        eventType: input.eventType,
      })
    ) {
      return {
        status: "synced",
        entity,
        skipped: true,
        reason: "self_write_or_unchanged",
      };
    }
    const customerDisplayName = await getCustomerDisplayName(
      admin,
      contact.customerPageId,
    );
    const row = contactDomainToIndexRow({
      contact,
      contentHash,
      notionLastEditedAt: lastEdited,
      syncStatus: "synced",
      customerDisplayName,
    });
    const { error } = await admin.from("contact_index").upsert(row as never);
    if (error) throw new Error(error.message);
    await insertAudit({
      admin,
      entityType: "contacts",
      notionPageId: input.pageId,
      changedFields: {
        summary: input.eventType ?? "page.sync",
        external_id: contact.externalId,
        content_hash: contentHash,
      },
    });
    return { status: "synced", entity };
  }

  if (entity === "deals") {
    const propertiesByName = await loadDealPropertyMap(admin);
    const deal = await notionPageToDeal({
      page: page as never,
      propertiesByName,
      pager,
    });
    const contentHash = hashDealDomain(deal);
    if (
      shouldSkipUnchanged({
        existing,
        lastEdited,
        contentHash,
        eventType: input.eventType,
      })
    ) {
      return {
        status: "synced",
        entity,
        skipped: true,
        reason: "self_write_or_unchanged",
      };
    }
    const [staffUserIds, statusSemantic, customerDisplayName] =
      await Promise.all([
        resolveStaffUserIds(admin, deal.staffPageIds),
        resolveStatusSemantic(admin, deal.statusPageId, "案件ステータス"),
        getCustomerDisplayName(admin, deal.customerPageId),
      ]);
    const row = dealDomainToIndexRow({
      deal,
      staffUserIds,
      statusSemantic,
      contentHash,
      notionLastEditedAt: lastEdited,
      syncStatus: "synced",
      customerDisplayName,
    });
    const { error } = await admin.from("deal_index").upsert(row as never);
    if (error) throw new Error(error.message);
    await insertAudit({
      admin,
      entityType: "deals",
      notionPageId: input.pageId,
      changedFields: {
        summary: input.eventType ?? "page.sync",
        external_id: deal.externalId,
        content_hash: contentHash,
        status_semantic: statusSemantic,
      },
    });
    await requestCustomerExpectedAmountRecalc({
      customerPageIds: [deal.customerPageId],
      sourceDealExternalId: deal.externalId,
      processInline: false,
    });
    return { status: "synced", entity };
  }

  if (entity === "activities") {
    const propertiesByName = await loadActivityPropertyMap(admin);
    const blocks = await listAllChildBlocks(notion, input.pageId);
    const activity = await notionPageToActivity({
      page: page as never,
      propertiesByName,
      pager,
      blocks,
    });
    const contentHash = hashActivityDomain(activity);
    if (
      shouldSkipUnchanged({
        existing,
        lastEdited,
        contentHash,
        eventType: input.eventType,
      })
    ) {
      return {
        status: "synced",
        entity,
        skipped: true,
        reason: "self_write_or_unchanged",
      };
    }
    const [customerDisplayName, dealTitle] = await Promise.all([
      getCustomerDisplayName(admin, activity.customerPageId),
      getDealTitle(admin, activity.dealPageId),
    ]);
    const row = activityDomainToIndexRow({
      activity,
      contentHash,
      notionLastEditedAt: lastEdited,
      syncStatus: "synced",
      customerDisplayName,
      dealTitle,
    });
    const { error } = await admin.from("activity_index").upsert(row as never);
    if (error) throw new Error(error.message);
    await insertAudit({
      admin,
      entityType: "activities",
      notionPageId: input.pageId,
      changedFields: {
        summary: input.eventType ?? "page.sync",
        external_id: activity.externalId,
        content_hash: contentHash,
        body_hash: activity.bodyHash,
      },
    });
    await requestCustomerLatestActivityRecalc({
      customerPageIds: [activity.customerPageId],
      sourceActivityExternalId: activity.externalId,
      processInline: false,
    });
    return { status: "synced", entity };
  }

  if (entity === "contracts") {
    const propertiesByName = await loadContractPropertyMap(admin);
    const contract = await notionPageToContract({
      page: page as never,
      propertiesByName,
      pager,
    });
    const contentHash = hashContractDomain(contract);
    if (
      shouldSkipUnchanged({
        existing,
        lastEdited,
        contentHash,
        eventType: input.eventType,
      })
    ) {
      return {
        status: "synced",
        entity,
        skipped: true,
        reason: "self_write_or_unchanged",
      };
    }
    const [staffUserIds, statusSemantic, customerDisplayName, dealTitle] =
      await Promise.all([
        resolveStaffUserIds(admin, contract.staffPageIds),
        resolveStatusSemantic(admin, contract.statusPageId, "契約状態"),
        getCustomerDisplayName(admin, contract.customerPageId),
        getDealTitle(admin, contract.dealPageId),
      ]);
    const row = contractDomainToIndexRow({
      contract,
      staffUserIds,
      statusSemantic,
      contentHash,
      notionLastEditedAt: lastEdited,
      syncStatus: "synced",
      customerDisplayName,
      dealTitle,
    });
    const { error } = await admin.from("contract_index").upsert(row as never);
    if (error) throw new Error(error.message);
    await insertAudit({
      admin,
      entityType: "contracts",
      notionPageId: input.pageId,
      changedFields: {
        summary: input.eventType ?? "page.sync",
        external_id: contract.externalId,
        content_hash: contentHash,
      },
    });
    return { status: "synced", entity };
  }

  if (entity === "complaints") {
    const propertiesByName = await loadComplaintPropertyMap(admin);
    const blocks = await listAllChildBlocks(notion, input.pageId);
    const complaint = await notionPageToComplaint({
      page: page as never,
      propertiesByName,
      pager,
      blocks,
    });
    const contentHash = hashComplaintDomain(complaint);
    if (
      shouldSkipUnchanged({
        existing,
        lastEdited,
        contentHash,
        eventType: input.eventType,
      })
    ) {
      return {
        status: "synced",
        entity,
        skipped: true,
        reason: "self_write_or_unchanged",
      };
    }
    const [assigneeUserId, statusSemantic, customerDisplayName, dealTitle] =
      await Promise.all([
        resolveAssigneeUserId(admin, complaint.staffPageId),
        resolveStatusSemantic(admin, complaint.statusPageId, "クレーム対応状況"),
        getCustomerDisplayName(admin, complaint.customerPageId),
        getDealTitle(admin, complaint.dealPageId),
      ]);
    const row = complaintDomainToIndexRow({
      complaint,
      assigneeUserId,
      statusSemantic,
      contentHash,
      notionLastEditedAt: lastEdited,
      syncStatus: "synced",
      customerDisplayName,
      dealTitle,
    });
    const { error } = await admin.from("complaint_index").upsert(row as never);
    if (error) throw new Error(error.message);
    await insertAudit({
      admin,
      entityType: "complaints",
      notionPageId: input.pageId,
      changedFields: {
        summary: input.eventType ?? "page.sync",
        external_id: complaint.externalId,
        content_hash: contentHash,
        body_hash: complaint.bodyHash,
      },
    });
    return { status: "synced", entity };
  }

  // actions
  const propertiesByName = await loadActionPropertyMap(admin);
  const action = await notionPageToAction({
    page: page as never,
    propertiesByName,
    pager,
  });
  const contentHash = hashActionDomain(action);
  if (
    shouldSkipUnchanged({
      existing,
      lastEdited,
      contentHash,
      eventType: input.eventType,
    })
  ) {
    return {
      status: "synced",
      entity,
      skipped: true,
      reason: "self_write_or_unchanged",
    };
  }
  const [assigneeUserId, statusSemantic, customerDisplayName, dealTitle] =
    await Promise.all([
      resolveAssigneeUserId(admin, action.staffPageId),
      resolveStatusSemantic(admin, action.statusPageId, "アクション状態"),
      getCustomerDisplayName(admin, action.customerPageId),
      getDealTitle(admin, action.dealPageId),
    ]);
  const row = actionDomainToIndexRow({
    action,
    assigneeUserId,
    statusSemantic,
    contentHash,
    notionLastEditedAt: lastEdited,
    syncStatus: "synced",
    customerDisplayName,
    dealTitle,
  });
  const { error } = await admin.from("action_index").upsert(row as never);
  if (error) throw new Error(error.message);
  await insertAudit({
    admin,
    entityType: "actions",
    notionPageId: input.pageId,
    changedFields: {
      summary: input.eventType ?? "page.sync",
      external_id: action.externalId,
      content_hash: contentHash,
      is_open: row.is_open,
    },
  });
  await requestNextActionRecalc({
    customerPageIds: [action.customerPageId],
    dealPageIds: [action.dealPageId],
    sourceActionExternalId: action.externalId,
    processInline: false,
  });
  return { status: "synced", entity };
}

export function isRetryableNotionError(error: unknown): boolean {
  if (error instanceof NotionHttpError) {
    if (error.status === 429) return true;
    if (error.status >= 500) return true;
  }
  const klass = classifyNotionError(error);
  return klass === "rate_limited" || klass === "transient";
}
