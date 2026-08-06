import "server-only";

import type { Client } from "@notionhq/client";

import { createAdminClient } from "@/lib/supabase/admin";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { SCHEMA_SNAPSHOT_KEY } from "@/lib/notion/setup/apply";
import type { PropertyIdMap } from "@/lib/notion/converters/contact";
import {
  executeContactCreate,
  executeContactUpdate,
  type ContactWriteDeps,
  type ContactWriteOpStore,
  type ContactIndexStore,
  type ContactAuditStore,
  type ContactSyncErrorStore,
  type CustomerSearchRefresh,
} from "@/lib/sync/contact-write-pipeline-core";
import type {
  ContactCreateCommand,
  ContactUpdateCommand,
  ContactWriteResult,
  WriteOperationRow,
  ContactRecoveryPayload,
} from "@/lib/contacts/types";
import { contactDomainToIndexRow } from "@/lib/contacts/index-mapper";
import {
  buildCustomerSearchText,
  buildCustomerSearchTextKana,
} from "@/lib/normalize";
import {
  logNotionError,
  logNotionInfo,
  logNotionWarn,
} from "@/lib/notion/logger";

export {
  executeContactCreate,
  executeContactUpdate,
} from "@/lib/sync/contact-write-pipeline-core";
export type { ContactWriteDeps } from "@/lib/sync/contact-write-pipeline-core";
export {
  ContactSyncError,
  isContactSyncError,
} from "@/lib/sync/errors";

type AdminClient = ReturnType<typeof createAdminClient>;

function createWriteOpStore(admin: AdminClient): ContactWriteOpStore {
  return {
    async getByRequestId(requestId) {
      const { data, error } = await admin
        .from("write_operations")
        .select("*")
        .eq("request_id", requestId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return data as unknown as WriteOperationRow;
    },
    async insertPending(row) {
      const { error } = await admin.from("write_operations").insert({
        request_id: row.requestId,
        entity_type: "contact",
        operation: row.operation,
        external_id: row.externalId,
        input_hash: row.inputHash,
        status: "pending",
        notion_page_id: row.notionPageId ?? null,
        recovery_payload: row.recoveryPayload as never,
        actor_id: row.actorId,
      } as never);
      if (error) throw new Error(error.message);
    },
    async markNotionDone(input) {
      const patch: Record<string, unknown> = {
        status: "notion_done",
        notion_page_id: input.notionPageId,
        error: null,
      };
      if (input.recoveryPayload !== undefined) {
        patch.recovery_payload = input.recoveryPayload;
      }
      const { error } = await admin
        .from("write_operations")
        .update(patch as never)
        .eq("request_id", input.requestId);
      if (error) throw new Error(error.message);
    },
    async markCompleted(requestId) {
      const { error } = await admin
        .from("write_operations")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          error: null,
        } as never)
        .eq("request_id", requestId);
      if (error) throw new Error(error.message);
    },
    async markFailed(requestId, message) {
      const { error } = await admin
        .from("write_operations")
        .update({
          status: "failed",
          error: message,
          completed_at: new Date().toISOString(),
        } as never)
        .eq("request_id", requestId);
      if (error) throw new Error(error.message);
    },
  };
}

function createIndexStore(admin: AdminClient): ContactIndexStore {
  return {
    async upsert(row) {
      const { error } = await admin.from("contact_index").upsert(row as never);
      if (error) throw new Error(error.message);
    },
  };
}

function createAuditStore(admin: AdminClient): ContactAuditStore {
  return {
    async insert(input) {
      const { error } = await admin.from("audit_logs").insert({
        actor_id: input.actorId,
        actor_name: input.actorName,
        action: input.action,
        entity_type: input.entityType,
        notion_page_id: input.notionPageId,
        changed_fields: input.changedFields,
        operation_source: input.operationSource,
        request_id: input.requestId,
      } as never);
      if (error) throw new Error(error.message);
    },
  };
}

function createSyncErrorStore(admin: AdminClient): ContactSyncErrorStore {
  return {
    async insert(input) {
      const { error } = await admin.from("sync_errors").insert({
        stage: input.stage,
        entity_type: input.entityType,
        notion_page_id: input.notionPageId ?? null,
        external_id: input.externalId ?? null,
        message: input.message,
        detail: input.detail ?? {},
      } as never);
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * 有効な担当者名で customer_index.search_text / search_text_kana を再構築。
 */
function createCustomerSearchRefresh(admin: AdminClient): CustomerSearchRefresh {
  return {
    async getDisplayName(customerPageId) {
      const { data, error } = await admin
        .from("customer_index")
        .select("display_name")
        .eq("notion_page_id", customerPageId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.display_name as string | undefined) ?? null;
    },
    async refreshForCustomer(customerPageId) {
      const [{ data: customer, error: customerError }, { data: contacts, error: contactsError }] =
        await Promise.all([
          admin
            .from("customer_index")
            .select(
              "notion_page_id,display_name,legal_name,office_name,prefecture,city,address_line,phone,email,representative_name",
            )
            .eq("notion_page_id", customerPageId)
            .maybeSingle(),
          admin
            .from("contact_index")
            .select("name,name_kana")
            .eq("customer_page_id", customerPageId)
            .eq("is_active", true),
        ]);
      if (customerError) throw new Error(customerError.message);
      if (contactsError) throw new Error(contactsError.message);
      if (!customer) return;

      const nameTokens = (contacts ?? [])
        .map((c) => c.name as string)
        .filter(Boolean);
      const kanaTokens = (contacts ?? [])
        .map((c) => (c.name_kana as string | null) ?? (c.name as string))
        .filter(Boolean);

      const searchSource = {
        displayName: customer.display_name as string,
        legalName: (customer.legal_name as string | null) ?? null,
        officeName: (customer.office_name as string | null) ?? null,
        prefecture: (customer.prefecture as string | null) ?? null,
        city: (customer.city as string | null) ?? null,
        addressLine: (customer.address_line as string | null) ?? null,
        phone: (customer.phone as string | null) ?? null,
        email: (customer.email as string | null) ?? null,
        representativeName:
          (customer.representative_name as string | null) ?? null,
        extraTokens: nameTokens,
      };

      const { error } = await admin
        .from("customer_index")
        .update({
          search_text: buildCustomerSearchText(searchSource),
          search_text_kana: buildCustomerSearchTextKana({
            ...searchSource,
            extraTokens: kanaTokens,
          }),
        } as never)
        .eq("notion_page_id", customerPageId);
      if (error) throw new Error(error.message);
    },
  };
}

export async function loadContactPropertyMap(
  admin: AdminClient = createAdminClient(),
): Promise<PropertyIdMap> {
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SCHEMA_SNAPSHOT_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = data?.value as {
    databases?: {
      contacts?: {
        properties?: Record<string, { id: string; name: string; type: string }>;
      };
    };
  } | null;
  const props = value?.databases?.contacts?.properties;
  if (!props) {
    throw new Error(
      "notion_schema_snapshot に contacts プロパティがありません",
    );
  }
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

export async function createContactWriteDeps(input?: {
  notion?: Client;
  admin?: AdminClient;
  contactsDataSourceId?: string;
}): Promise<ContactWriteDeps> {
  const admin = input?.admin ?? createAdminClient();
  const ds =
    input?.contactsDataSourceId ?? process.env.NOTION_DS_CONTACTS ?? "";
  if (!ds) {
    throw new Error("NOTION_DS_CONTACTS が設定されていません");
  }
  const propertiesByName = await loadContactPropertyMap(admin);
  return {
    notion: input?.notion ?? createDefaultNotionClient(),
    contactsDataSourceId: ds,
    propertiesByName,
    writeOps: createWriteOpStore(admin),
    index: createIndexStore(admin),
    audit: createAuditStore(admin),
    syncErrors: createSyncErrorStore(admin),
    customerSearch: createCustomerSearchRefresh(admin),
    logger: {
      info: (fields) =>
        logNotionInfo({
          request_id: String(fields.request_id ?? "n/a"),
          ...fields,
        }),
      warn: (fields) =>
        logNotionWarn({
          request_id: String(fields.request_id ?? "n/a"),
          ...fields,
        }),
      error: (fields) =>
        logNotionError({
          request_id: String(fields.request_id ?? "n/a"),
          ...fields,
        }),
    },
  };
}

/** Server Action等から呼ぶ先方担当者作成 */
export async function contactCreate(
  command: ContactCreateCommand,
): Promise<ContactWriteResult> {
  const deps = await createContactWriteDeps();
  return executeContactCreate(deps, command);
}

/** Server Action等から呼ぶ先方担当者更新(無効化含む) */
export async function contactUpdate(
  command: ContactUpdateCommand,
): Promise<ContactWriteResult> {
  const deps = await createContactWriteDeps();
  return executeContactUpdate(deps, command);
}

export type { ContactRecoveryPayload };
export type IndexRow = ReturnType<typeof contactDomainToIndexRow>;
