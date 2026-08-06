/**
 * Phase 3 先方担当者 write pipeline 実Notion/Supabase E2E。
 * 氏名 test_phase3_contact_* のテスト担当者を作成・更新する。
 * request_id / external_id / notion_page_id は全文をログしない。
 *
 * Usage: npx tsx scripts/e2e-contact-write.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "@notionhq/client";

import {
  createNotionClient,
  NotionHttpError,
} from "../src/lib/notion/client-core";
import { SupabaseNotionRateLimiter } from "../src/lib/notion/rate-limiter-core";
import { newRequestId } from "../src/lib/notion/ids";
import { SCHEMA_SNAPSHOT_KEY } from "../src/lib/notion/setup/apply";
import type { PropertyIdMap } from "../src/lib/notion/converters/contact";
import { notionPageToContact } from "../src/lib/notion/converters/contact";
import type {
  ContactWriteInput,
  WriteOperationRow,
} from "../src/lib/contacts/types";
import {
  executeContactCreate,
  executeContactUpdate,
  type ContactWriteDeps,
  type ContactWriteOpStore,
  type ContactIndexStore,
  type ContactAuditStore,
  type ContactSyncErrorStore,
  type CustomerSearchRefresh,
} from "../src/lib/sync/contact-write-pipeline-core";
import { isContactSyncError } from "../src/lib/sync/errors";
import { prepareContactWrite } from "../src/lib/contacts/write-schema";
import {
  buildCustomerSearchText,
  buildCustomerSearchTextKana,
  normalizePhone,
} from "../src/lib/normalize";
import {
  logNotionError,
  logNotionInfo,
  logNotionWarn,
} from "../src/lib/notion/logger";

const AFFILIATE_CUSTOMER_ID = "3b46185e-ff11-81ca-a378-f5f651577a37";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    process.env[key] = value;
  }
}

function maskId(id: string): string {
  if (id.length < 12) return "[id]";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function ok(step: string, detail?: string) {
  console.log(`- [OK] ${step}${detail ? `: ${detail}` : ""}`);
}
function ng(step: string, detail?: string): never {
  console.error(`- [NG] ${step}${detail ? `: ${detail}` : ""}`);
  throw new Error(`E2E failed at ${step}`);
}

type Admin = {
  from: (table: string) => any;
};

function createWriteOpStore(admin: Admin): ContactWriteOpStore {
  return {
    async getByRequestId(requestId) {
      const { data, error } = await admin
        .from("write_operations")
        .select("*")
        .eq("request_id", requestId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as WriteOperationRow) ?? null;
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

function createIndexStore(admin: Admin): ContactIndexStore {
  return {
    async upsert(row) {
      const { error } = await admin.from("contact_index").upsert(row as never);
      if (error) throw new Error(error.message);
    },
  };
}

function createAuditStore(admin: Admin): ContactAuditStore {
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

function createSyncErrorStore(admin: Admin): ContactSyncErrorStore {
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

function createCustomerSearchRefresh(admin: Admin): CustomerSearchRefresh {
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
      const [
        { data: customer, error: customerError },
        { data: contacts, error: contactsError },
      ] = await Promise.all([
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
        .map((c: { name: string }) => c.name)
        .filter(Boolean);
      const kanaTokens = (contacts ?? [])
        .map(
          (c: { name: string; name_kana: string | null }) =>
            c.name_kana ?? c.name,
        )
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

async function loadPropertyMap(admin: Admin): Promise<PropertyIdMap> {
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SCHEMA_SNAPSHOT_KEY)
    .maybeSingle();
  if (error || !data?.value) throw new Error("snapshot missing");
  const props = (
    data.value as {
      databases: {
        contacts: {
          properties: Record<string, { id: string; type: string }>;
        };
      };
    }
  ).databases.contacts.properties;
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

async function buildDeps(
  notion: Client,
  admin: Admin,
  contactsDs: string,
): Promise<ContactWriteDeps> {
  return {
    notion,
    contactsDataSourceId: contactsDs,
    propertiesByName: await loadPropertyMap(admin),
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

async function findMasterPageId(
  admin: Admin,
  masterType: string,
  name: string,
): Promise<string> {
  const { data, error } = await admin
    .from("masters_cache")
    .select("notion_page_id")
    .eq("master_type", masterType)
    .eq("name", name)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const id = data?.notion_page_id as string | undefined;
  if (!id) throw new Error(`master not found: ${masterType}/${name}`);
  return id;
}

async function countPagesByExternalId(
  notion: Client,
  contactsDs: string,
  externalId: string,
): Promise<number> {
  const q = await notion.dataSources.query({
    data_source_id: contactsDs,
    filter: {
      property: "external_id",
      rich_text: { equals: externalId },
    },
    page_size: 10,
  } as never);
  return (q as { results: unknown[] }).results.length;
}

function proxyPages(
  notion: Client,
  overrides: {
    create?: Client["pages"]["create"];
    update?: Client["pages"]["update"];
  },
): Client {
  return new Proxy(notion, {
    get(target, prop, receiver) {
      if (prop === "pages") {
        const pages = Reflect.get(target, prop, receiver) as Client["pages"];
        return new Proxy(pages, {
          get(pTarget, pProp, pReceiver) {
            if (pProp === "create" && overrides.create) return overrides.create;
            if (pProp === "update" && overrides.update) return overrides.update;
            return Reflect.get(pTarget, pProp, pReceiver);
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Client;
}

async function loadDomain(
  notion: Client,
  pageId: string,
  propertiesByName: PropertyIdMap,
) {
  return notionPageToContact({
    page: (await notion.pages.retrieve({ page_id: pageId })) as never,
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
}

async function main() {
  loadEnvLocal();
  const suffix = randomBytes(3).toString("hex");
  const contactName = `test_phase3_contact_20260806_${suffix}`;
  console.log(`## E2E start name=${contactName}`);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ) as unknown as Admin & ReturnType<typeof createClient>;

  const { data: actor, error: actorError } = await supabase
    .from("app_users")
    .select("id,display_name,role,provisioning_status")
    .eq("role", "admin")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (actorError || !actor) throw new Error("admin actor missing");
  ok("actor", `role=${actor.role} id=${maskId(actor.id)}`);

  const rateLimiter = new SupabaseNotionRateLimiter({
    createClient: () => supabase as never,
  });
  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN!,
    rateLimiter,
    defaultPriority: "interactive",
  });

  const contactsDs = process.env.NOTION_DS_CONTACTS!;
  if (!contactsDs) throw new Error("NOTION_DS_CONTACTS missing");

  // 1 affiliate non-archived test customer
  const { data: affiliate } = await supabase
    .from("customer_index")
    .select("notion_page_id,display_name,is_archived")
    .eq("notion_page_id", AFFILIATE_CUSTOMER_ID)
    .maybeSingle();
  if (!affiliate) ng("1 affiliate customer missing");
  if (affiliate.is_archived) ng("1 affiliate is archived");
  ok(
    "1 affiliate non-archived",
    `customer=${maskId(affiliate.notion_page_id)} name=${affiliate.display_name}`,
  );

  // masters_cache経由(本番マスタを変更せず、Notion queryの一時障害も回避)
  const contactTypeId = await findMasterPageId(
    supabase as Admin,
    "担当者区分",
    "担当者",
  );
  ok("masters resolved", `担当者=${maskId(contactTypeId)}`);

  const baseDeps = await buildDeps(notion, supabase as Admin, contactsDs);

  const input: ContactWriteInput = {
    name: contactName,
    nameKana: "てすとたんとう",
    customerPageId: AFFILIATE_CUSTOMER_ID,
    department: "E2E部署",
    title: "E2E役職",
    phone: "03-1234-5678",
    email: "test-phase3-contact@example.invalid",
    contactTypePageId: contactTypeId,
    note: "phase3 e2e",
    isActive: true,
  };

  const createRequestId = newRequestId();
  const externalId = newRequestId();

  // 2 create
  const created = await executeContactCreate(baseDeps, {
    requestId: createRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if (created.status !== "completed" || !created.notionPageId) {
    ng("2 create completed", `status=${created.status}`);
  }
  ok("2 create", `page=${maskId(created.notionPageId!)} ext=${maskId(externalId)}`);

  // 3 one notion page
  if ((await countPagesByExternalId(notion, contactsDs, externalId)) !== 1) {
    ng("3 single page");
  }
  ok("3 single notion page");

  // 4 external_id
  const domain = await loadDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (domain.externalId !== externalId) ng("4 external_id match");
  if (domain.name !== contactName) ng("4 name");
  if (domain.customerPageId !== AFFILIATE_CUSTOMER_ID) ng("4 customer");
  ok("4 external_id + properties");

  // 5 contact_index
  const { data: indexRow } = await supabase
    .from("contact_index")
    .select("*")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (!indexRow) ng("5 contact_index");
  if (indexRow.phone !== "03-1234-5678") ng("5 phone display");
  if (indexRow.phone_normalized !== normalizePhone("03-1234-5678")) {
    ng("5 phone_normalized");
  }
  ok("5 contact_index", `sync=${indexRow.sync_status}`);

  // 6 write_operations completed
  const { data: wo } = await supabase
    .from("write_operations")
    .select("status,external_id,entity_type")
    .eq("request_id", createRequestId)
    .maybeSingle();
  if (wo?.status !== "completed") ng("6 write_operations", String(wo?.status));
  if (wo?.external_id !== externalId) ng("6 write_op external_id");
  if (wo?.entity_type !== "contact") ng("6 entity_type contact");
  ok("6 write_operations completed");

  // 7 audit contact.create
  const { count: auditCreateCount } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("request_id", createRequestId)
    .eq("action", "contact.create");
  if (auditCreateCount !== 1) ng("7 audit create", `count=${auditCreateCount}`);
  ok("7 audit_logs contact.create x1");

  // 8 idempotent
  const again = await executeContactCreate(baseDeps, {
    requestId: createRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if (again.notionPageId !== created.notionPageId) ng("8 idempotent page id");
  if ((await countPagesByExternalId(notion, contactsDs, externalId)) !== 1) {
    ng("8 no duplicate page");
  }
  const { count: auditCreateCount2 } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("request_id", createRequestId)
    .eq("action", "contact.create");
  if ((auditCreateCount2 ?? 0) !== 1) {
    ng("8 audit not duplicated", `count=${auditCreateCount2}`);
  }
  ok("8 idempotent re-run no dup");

  // 9 hash mismatch reject
  let hashMismatchCaught = false;
  try {
    await executeContactCreate(baseDeps, {
      requestId: createRequestId,
      actorId: actor.id,
      actorName: actor.display_name,
      externalId,
      input: { ...input, name: `${contactName}_changed` },
    });
  } catch (error) {
    if (isContactSyncError(error) && error.code === "input_hash_mismatch") {
      hashMismatchCaught = true;
    } else {
      ng("9 unexpected error type");
    }
  }
  if (!hashMismatchCaught) ng("9 hash mismatch not thrown");
  ok("9 input_hash mismatch rejected");

  // 10 update
  const detailPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const lastEdited = (detailPage as { last_edited_time: string }).last_edited_time;
  const updateRequestId = newRequestId();
  const updatedInput: ContactWriteInput = {
    ...input,
    phone: "03-9999-0000",
    department: "更新部署",
  };
  const updated = await executeContactUpdate(baseDeps, {
    requestId: updateRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: lastEdited,
    input: updatedInput,
  });
  if (updated.status !== "completed") ng("10 update", updated.status);
  ok("10 update completed");

  // 11 notion+index
  const { data: indexAfter } = await supabase
    .from("contact_index")
    .select("phone,phone_normalized,department")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (indexAfter?.phone !== "03-9999-0000") ng("11 index phone");
  if (indexAfter?.department !== "更新部署") ng("11 index department");
  const afterDomain = await loadDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (afterDomain.phone !== "03-9999-0000") ng("11 notion phone");
  ok("11 notion+index updated");

  // 12 audit before/after
  const { data: auditUpdate } = await supabase
    .from("audit_logs")
    .select("changed_fields")
    .eq("request_id", updateRequestId)
    .eq("action", "contact.update")
    .maybeSingle();
  const changed = auditUpdate?.changed_fields as Record<
    string,
    { before?: unknown; after?: unknown }
  > | null;
  if (!changed?.["電話番号"]?.before || !changed?.["電話番号"]?.after) {
    ng("12 audit before/after");
  }
  ok("12 audit update before/after");

  // 13 stale last_edited_time conflict
  let conflictOk = false;
  try {
    await executeContactUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: "2000-01-01T00:00:00.000Z",
      input: { ...updatedInput, department: "競合部署" },
    });
  } catch (error) {
    if (isContactSyncError(error) && error.code === "conflict") conflictOk = true;
  }
  if (!conflictOk) ng("13 conflict");
  const { data: indexConflict } = await supabase
    .from("contact_index")
    .select("department")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (indexConflict?.department !== "更新部署") ng("13 no overwrite on conflict");
  ok("13 optimistic lock conflict");

  // 14 notion_done resume (inject index failure)
  const resumePage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const resumeEdited = (resumePage as { last_edited_time: string })
    .last_edited_time;
  const resumeReq = newRequestId();
  let upsertCalls = 0;
  const failingDeps: ContactWriteDeps = {
    ...baseDeps,
    index: {
      async upsert(row) {
        upsertCalls += 1;
        if (upsertCalls === 1) throw new Error("injected_index_failure");
        return baseDeps.index.upsert(row);
      },
    },
  };
  const resumeInput: ContactWriteInput = {
    ...updatedInput,
    title: "再開役職",
  };
  const partial = await executeContactUpdate(failingDeps, {
    requestId: resumeReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: resumeEdited,
    input: resumeInput,
  });
  if (partial.status !== "notion_done") {
    ng("14 notion_done after inject", partial.status);
  }
  const beforeResumeCount = await countPagesByExternalId(
    notion,
    contactsDs,
    externalId,
  );
  const resumed = await executeContactUpdate(failingDeps, {
    requestId: resumeReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: resumeEdited,
    input: resumeInput,
  });
  if (resumed.status !== "completed") ng("14 resume completed", resumed.status);
  if (
    (await countPagesByExternalId(notion, contactsDs, externalId)) !==
    beforeResumeCount
  ) {
    ng("14 no new page on resume");
  }
  ok("14 notion_done resume");

  // 15 ambiguous create
  const ambCreateExt = newRequestId();
  const ambCreateReq = newRequestId();
  const ambCreateName = `${contactName}_ambcreate`;
  const createProxy = proxyPages(notion, {
    create: async (args) => {
      await notion.pages.create(args);
      throw new NotionHttpError(503, "write_ambiguous_failure", "e2e-amb-c");
    },
  });
  const ambCreateDeps = await buildDeps(
    createProxy,
    supabase as Admin,
    contactsDs,
  );
  const ambCreateResult = await executeContactCreate(ambCreateDeps, {
    requestId: ambCreateReq,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId: ambCreateExt,
    input: { ...input, name: ambCreateName },
  });
  if (
    ambCreateResult.status !== "completed" &&
    ambCreateResult.status !== "notion_done"
  ) {
    ng("15 amb create status", ambCreateResult.status);
  }
  if ((await countPagesByExternalId(notion, contactsDs, ambCreateExt)) !== 1) {
    ng("15 no dup after amb create");
  }
  ok("15 ambiguous create recovery");

  // deactivate amb create contact to keep test data tidy
  if (ambCreateResult.notionPageId) {
    const p = await notion.pages.retrieve({
      page_id: ambCreateResult.notionPageId,
    });
    await executeContactUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: ambCreateResult.notionPageId,
      externalId: ambCreateExt,
      expectedLastEditedTime: (p as { last_edited_time: string }).last_edited_time,
      input: { ...input, name: ambCreateName, isActive: false },
    });
  }

  // 16 ambiguous update content_hash
  const cur = await notion.pages.retrieve({ page_id: created.notionPageId! });
  const curEdited = (cur as { last_edited_time: string }).last_edited_time;
  const ambUpdReq = newRequestId();
  let updateCalled = false;
  const updateProxy = proxyPages(notion, {
    update: async (args) => {
      await notion.pages.update(args);
      updateCalled = true;
      throw new NotionHttpError(503, "write_ambiguous_failure", "e2e-amb-u");
    },
  });
  const ambUpdDeps = await buildDeps(updateProxy, supabase as Admin, contactsDs);
  const ambUpdInput: ContactWriteInput = {
    ...resumeInput,
    note: "曖昧復旧メモ",
  };
  const ambUpd = await executeContactUpdate(ambUpdDeps, {
    requestId: ambUpdReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: curEdited,
    input: ambUpdInput,
  });
  if (!updateCalled) ng("16 update was not called");
  if (ambUpd.status !== "completed" && ambUpd.status !== "notion_done") {
    ng("16 amb update status", ambUpd.status);
  }
  const afterAmb = await loadDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (afterAmb.note !== "曖昧復旧メモ") {
    ng("16 hash-aligned update applied");
  }
  ok("16 ambiguous update recovered via content_hash");

  // also mismatch path
  const mismatchReq = newRequestId();
  const pageBeforeMismatch = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const mismatchProxy = proxyPages(notion, {
    update: async () => {
      throw new NotionHttpError(503, "write_ambiguous_failure", "e2e-amb-mismatch");
    },
  });
  const mismatchDeps = await buildDeps(
    mismatchProxy,
    supabase as Admin,
    contactsDs,
  );
  let mismatchStopped = false;
  try {
    await executeContactUpdate(mismatchDeps, {
      requestId: mismatchReq,
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: (
        pageBeforeMismatch as { last_edited_time: string }
      ).last_edited_time,
      input: { ...ambUpdInput, department: "不一致部署" },
    });
  } catch (error) {
    if (isContactSyncError(error) && error.code === "ambiguous_write") {
      mismatchStopped = true;
    } else {
      throw error;
    }
  }
  if (!mismatchStopped) ng("16 mismatch stop");
  const { data: deptCheck } = await supabase
    .from("contact_index")
    .select("department")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (deptCheck?.department === "不一致部署") ng("16 no auto overwrite");
  ok("16 ambiguous update mismatch guarded");

  // 17 bad contact type rejected BEFORE notion
  const badTypeReq = newRequestId();
  let badTypeRejected = false;
  try {
    await prepareContactWrite({
      data: {
        name: `${contactName}_badtype`,
        customerPageId: AFFILIATE_CUSTOMER_ID,
        contactTypePageId: newRequestId(),
      },
      db: supabase,
    });
  } catch (error) {
    if (isContactSyncError(error) && error.code === "validation") {
      badTypeRejected = true;
    }
  }
  if (!badTypeRejected) ng("17 bad type not rejected");
  const { data: badOp } = await supabase
    .from("write_operations")
    .select("request_id")
    .eq("request_id", badTypeReq)
    .maybeSingle();
  if (badOp) ng("17 write_operations should not exist");
  ok("17 bad contact type rejected before notion");

  // 18 archived customer new contact rejected
  const { data: archivedCust } = await supabase
    .from("customer_index")
    .select("notion_page_id")
    .eq("is_archived", true)
    .ilike("display_name", "test_%")
    .limit(1)
    .maybeSingle();
  if (archivedCust?.notion_page_id) {
    let archivedRejected = false;
    try {
      await prepareContactWrite({
        data: {
          name: `${contactName}_archived`,
          customerPageId: archivedCust.notion_page_id,
          contactTypePageId: contactTypeId,
        },
        db: supabase,
      });
    } catch (error) {
      if (
        isContactSyncError(error) &&
        error.detail?.reason === "archived_customer_forbidden"
      ) {
        archivedRejected = true;
      }
    }
    if (!archivedRejected) ng("18 archived customer not rejected");
    ok("18 archived customer new contact rejected");
  } else {
    ok("18 archived customer test skipped (no archived test customer)");
  }

  // 19 deactivate isActive=false
  const deactPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const deactivated = await executeContactUpdate(baseDeps, {
    requestId: newRequestId(),
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (deactPage as { last_edited_time: string })
      .last_edited_time,
    input: { ...ambUpdInput, isActive: false },
  });
  if (deactivated.status !== "completed") ng("19 deactivate", deactivated.status);
  const deactDomain = await loadDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (deactDomain.isActive) ng("19 notion isActive false");
  const { data: deactIndex } = await supabase
    .from("contact_index")
    .select("is_active")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (deactIndex?.is_active !== false) ng("19 index is_active false");
  ok("19 deactivate isActive=false");

  // 20 not in_trash
  if (deactDomain.inTrash) ng("20 in_trash");
  ok("20 not in_trash");

  // 21 audit retained
  const { count: auditStill } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("notion_page_id", created.notionPageId!);
  if (!auditStill || auditStill < 1) ng("21 audit retained");
  ok("21 audit_logs retained", `count=${auditStill}`);

  console.log(
    `ids: request_id=${maskId(createRequestId)} external_id=${maskId(externalId)} page=${maskId(created.notionPageId!)}`,
  );
  console.log("\nE2E PASSED");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown";
  console.error(`e2e failed: ${message}`);
  process.exit(1);
});
