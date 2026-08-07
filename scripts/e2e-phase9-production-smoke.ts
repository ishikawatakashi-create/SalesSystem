/**
 * Phase 9 Production CRM smoke.
 * PREFIX=test_phase9_e2e_<8char>. Never log secrets/PII/full UUIDs/CSV/webhook bodies.
 *
 * Usage (PowerShell):
 *   $env:NODE_OPTIONS='--require ./scripts/shims/mock-server-only.cjs'; npx tsx scripts/e2e-phase9-production-smoke.ts
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "@notionhq/client";

import { createNotionClient } from "../src/lib/notion/client-core";
import { SupabaseNotionRateLimiter } from "../src/lib/notion/rate-limiter-core";
import { newRequestId, uuidV5 } from "../src/lib/notion/ids";
import { todayDateTokyo } from "../src/lib/normalize/date-tokyo";
import { isCustomerSyncError } from "../src/lib/sync/errors";
import { customerCreate, customerUpdate } from "../src/lib/sync/write-pipeline";
import { contactCreate, contactUpdate } from "../src/lib/sync/contact-write-pipeline";
import { dealCreate, dealUpdate } from "../src/lib/sync/deal-write-pipeline";
import { activityCreate } from "../src/lib/sync/activity-write-pipeline";
import { actionCreate, actionUpdate } from "../src/lib/sync/action-write-pipeline";
import { contractCreate } from "../src/lib/sync/contract-write-pipeline";
import { complaintCreate } from "../src/lib/sync/complaint-write-pipeline";
import { createImportUploadUrl } from "../src/lib/csv/storage";
import { suggestMapping } from "../src/lib/csv/mapping";
import { parseCsv } from "../src/lib/csv/parser";
import { validateAndStageImport } from "../src/lib/csv/validate-and-stage";
import { enqueueJob } from "../src/lib/jobs/queue";
import type { CustomerWriteInput } from "../src/lib/customers/types";

const MARKER = randomUUID().slice(0, 8);
const PREFIX = `test_phase9_e2e_${MARKER}`;
const SOURCE = "phase9_prod_smoke";
const BASE =
  process.env.PRODUCTION_BASE_URL?.replace(/\/$/, "") ||
  "https://sales-system-weld.vercel.app";
const AMT = 88_000;

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

function mask(id: string | null | undefined): string {
  if (!id || id.length < 12) return "[id]";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

let okN = 0;
let ngN = 0;
let skipN = 0;
function ok(s: string, d?: string) {
  okN += 1;
  console.log(`[OK] ${s}${d ? `: ${d}` : ""}`);
}
function ng(s: string, d?: string) {
  ngN += 1;
  console.error(`[NG] ${s}${d ? `: ${d}` : ""}`);
}
function skip(s: string, d: string) {
  skipN += 1;
  console.log(`[SKIP] ${s}: ${d}`);
}
function info(s: string, d?: string) {
  console.log(`[INFO] ${s}${d ? `: ${d}` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Admin = ReturnType<typeof createClient>;

async function triggerJobs(rounds = 16): Promise<number> {
  const cron = process.env.CRON_SECRET?.trim();
  if (!cron) return 0;
  let total = 0;
  for (let i = 0; i < rounds; i += 1) {
    const res = await fetch(`${BASE}/api/jobs/run`, {
      method: "POST",
      headers: { "x-cron-secret": cron },
    });
    if (res.status !== 200) break;
    const n = ((await res.json()) as { processed?: number }).processed ?? 0;
    total += n;
    if (n === 0) break;
    await sleep(500);
  }
  return total;
}

async function master(
  admin: Admin,
  type: string,
  semantic?: string,
): Promise<string | null> {
  let q = admin
    .from("masters_cache")
    .select("notion_page_id")
    .eq("master_type", type)
    .eq("is_active", true);
  if (semantic) q = q.eq("semantic_key", semantic);
  const { data } = await q.limit(1).maybeSingle();
  return (data?.notion_page_id as string | undefined) ?? null;
}

async function edited(notion: Client, pageId: string): Promise<string> {
  const page = await notion.pages.retrieve({ page_id: pageId });
  return (page as { last_edited_time: string }).last_edited_time;
}

function phone(n: number): string {
  const mid = String(1000 + (parseInt(MARKER.slice(0, 2), 16) % 9000)).padStart(
    4,
    "0",
  );
  const tail = `${MARKER}${n}`.replace(/\D/g, "").slice(-4).padStart(4, "0");
  return `090-${mid}-${tail}`;
}

function oneRowCsv(): string {
  const cols = [
    `${PREFIX}_csv_src`,
    `${PREFIX}_csv_cust`,
    `架空法人CSV_${MARKER}`,
    `支社_${MARKER}`,
    `080-${String(2000 + (parseInt(MARKER.slice(0, 3), 16) % 8000)).padStart(4, "0")}-${MARKER.replace(/\D/g, "").slice(-4).padStart(4, "0")}`,
    `smoke_p9_csv_${MARKER}@example.test`,
    "大阪府",
    "大阪市",
    `架空町CSV${MARKER}-1`,
  ].map((c) => (c.includes(",") ? `"${c}"` : c));
  return (
    "移行元ID,表示名,法人名,事業所名,電話番号,メール,都道府県,市区町村,住所\r\n" +
    cols.join(",") +
    "\r\n"
  );
}

function fromIndex(row: Record<string, unknown>, displayName: string): CustomerWriteInput {
  return {
    displayName,
    legalName: (row.legal_name as string) ?? null,
    officeName: (row.office_name as string) ?? null,
    postalCode: (row.postal_code as string) ?? null,
    prefecture: (row.prefecture as string) ?? null,
    city: (row.city as string) ?? null,
    addressLine: (row.address_line as string) ?? null,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    representativeName: (row.representative_name as string) ?? null,
    website: (row.website as string) ?? null,
    businessCategoryPageIds: (row.business_category_ids as string[]) ?? [],
    tagPageIds: (row.tag_ids as string[]) ?? [],
    salesStatusPageId: (row.sales_status_id as string) ?? null,
    acquisitionRoutePageId: (row.acquisition_route_id as string) ?? null,
    priorityPageId: (row.priority_id as string) ?? null,
    staffPageIds: [],
    relatedAccountPageIds: [],
    isArchived: false,
  };
}

const CUST_COLS =
  "notion_page_id,external_id,display_name,legal_name,office_name,postal_code,prefecture,city,address_line,phone,email,representative_name,website,business_category_ids,tag_ids,sales_status_id,acquisition_route_id,priority_id,is_archived,expected_amount";

async function main() {
  loadEnvLocal();
  info("prefix", PREFIX);
  for (const k of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "NOTION_TOKEN",
    "NOTION_DS_CUSTOMERS",
    "CRON_SECRET",
  ]) {
    if (!process.env[k]?.trim()) {
      ng("env", `missing ${k}`);
      process.exit(1);
    }
  }
  ok("env");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: actor } = await admin
    .from("app_users")
    .select("id,display_name,notion_staff_page_id")
    .eq("role", "admin")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!actor?.id) {
    ng("actor");
    process.exit(1);
  }
  const actorId = String(actor.id);
  const actorName = String(actor.display_name ?? "admin");
  const staffPageId = (actor.notion_staff_page_id as string | null) ?? null;
  ok("actor", mask(actorId));

  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN!,
    rateLimiter: new SupabaseNotionRateLimiter({
      createClient: () => admin as never,
    }),
    defaultPriority: "interactive",
  });
  const today = todayDateTokyo();
  const name = `${PREFIX}_cust`;

  // 1 customer
  const customerExt = newRequestId();
  const cust = await customerCreate({
    requestId: newRequestId(),
    actorId,
    actorName,
    externalId: customerExt,
    input: {
      ...fromIndex({}, name),
      legalName: `架空法人_${MARKER}`,
      prefecture: "東京都",
      city: "千代田区",
      addressLine: `架空町${MARKER}-1`,
      phone: phone(1),
      staffPageIds: staffPageId ? [staffPageId] : [],
    },
  });
  if (cust.status !== "completed" || !cust.notionPageId) {
    ng("1_customer", cust.status);
    process.exit(1);
  }
  const customerPageId = cust.notionPageId;
  ok("1_customer", mask(customerPageId));

  // 2 contact
  const contactExt = newRequestId();
  const contact = await contactCreate({
    requestId: newRequestId(),
    actorId,
    actorName,
    externalId: contactExt,
    input: {
      name: `${PREFIX}_contact`,
      nameKana: null,
      customerPageId,
      department: "営業",
      title: null,
      phone: phone(2),
      email: null,
      contactTypePageId: null,
      note: null,
      isActive: true,
    },
  });
  const contactPageId = contact.notionPageId;
  if (contact.status === "completed" && contactPageId) ok("2_contact", mask(contactPageId));
  else ng("2_contact", contact.status);

  // 3 deal active + amount
  const statusActive = await master(admin, "案件ステータス", "active");
  const statusLost = await master(admin, "案件ステータス", "lost");
  if (!statusActive) {
    ng("3_deal_master");
    process.exit(1);
  }
  const dealExt = newRequestId();
  const deal = await dealCreate({
    requestId: newRequestId(),
    actorId,
    actorName,
    externalId: dealExt,
    input: {
      title: `${PREFIX}_deal`,
      customerPageId,
      contactPageIds: contactPageId ? [contactPageId] : [],
      businessCategoryPageId: null,
      productName: "P9",
      stagePageId: null,
      staffPageIds: staffPageId ? [staffPageId] : [],
      expectedAmount: AMT,
      contractAmount: null,
      probability: 50,
      expectedCloseDate: null,
      contractedAt: null,
      periodStart: null,
      periodEnd: null,
      lostReason: null,
      statusPageId: statusActive,
      note: "p9",
    },
  });
  const dealPageId = deal.notionPageId;
  if (deal.status === "completed" && dealPageId) ok("3_deal", mask(dealPageId));
  else ng("3_deal", deal.status);

  // 4 rollup
  let rollup = false;
  for (let i = 0; i < 12; i += 1) {
    await triggerJobs(4);
    const { data } = await admin
      .from("customer_index")
      .select("expected_amount")
      .eq("notion_page_id", customerPageId)
      .maybeSingle();
    if (Number(data?.expected_amount ?? -1) === AMT) {
      rollup = true;
      break;
    }
    await sleep(1200);
  }
  if (rollup) ok("4_expected_amount");
  else ng("4_expected_amount");

  // 5 activity
  const act = await activityCreate({
    requestId: newRequestId(),
    actorId,
    actorName,
    input: {
      title: `${PREFIX}_activity`,
      customerPageId,
      dealPageId: dealPageId ?? null,
      contactPageIds: contactPageId ? [contactPageId] : [],
      activityAt: new Date().toISOString(),
      categoryPageIds: [],
      summary: null,
      nextActionNote: null,
      nextActionDate: null,
      body: "p9 body",
      batchId: null,
    },
  });
  if (act.status === "completed" && act.notionPageId) ok("5_activity", mask(act.notionPageId));
  else ng("5_activity", act.status);

  // 6–7 action open today + index/assignee + mydesk query shape
  const openSt = await master(admin, "アクション状態", "open");
  const doneSt = await master(admin, "アクション状態", "done");
  if (!openSt || !doneSt) {
    ng("6_action_master");
    process.exit(1);
  }
  const actionExt = newRequestId();
  const action = await actionCreate({
    requestId: newRequestId(),
    actorId,
    actorName,
    externalId: actionExt,
    input: {
      title: `${PREFIX}_action`,
      customerPageId,
      dealPageId: dealPageId ?? null,
      activityPageId: null,
      staffPageId,
      dueDate: today,
      statusPageId: openSt,
      priorityPageId: null,
      completedAt: null,
    },
  });
  if (action.status !== "completed" || !action.notionPageId) {
    ng("6_action", action.status);
    process.exit(1);
  }
  const actionPageId = action.notionPageId;
  ok("6_action", mask(actionPageId));

  const { data: aIdx } = await admin
    .from("action_index")
    .select("is_open,due_date,assignee_user_id,staff_page_id")
    .eq("notion_page_id", actionPageId)
    .maybeSingle();
  const assigneeOk =
    aIdx?.is_open === true &&
    aIdx.due_date === today &&
    (aIdx.assignee_user_id === actorId ||
      (!aIdx.assignee_user_id && staffPageId && aIdx.staff_page_id === staffPageId));
  if (assigneeOk) ok("7_action_index_open");
  else ng("7_action_index_open");

  skip("mydesk_ui", "loadMyDesk needs Next session; action_index query verified");
  const { data: desk } = await admin
    .from("action_index")
    .select("notion_page_id")
    .eq("notion_page_id", actionPageId)
    .eq("is_open", true)
    .lte("due_date", today)
    .maybeSingle();
  if (desk) ok("7b_mydesk_query_today");
  else ng("7b_mydesk_query_today");

  // 8 search index
  const { data: hit } = await admin
    .from("customer_index")
    .select("display_name")
    .eq("notion_page_id", customerPageId)
    .ilike("display_name", `${PREFIX}%`)
    .maybeSingle();
  if (hit?.display_name === name) ok("8_search_index");
  else ng("8_search_index");
  skip("globalSearch", "needs server user session; index ilike covers search path");

  // 9 complete
  await actionUpdate({
    requestId: newRequestId(),
    actorId,
    actorName,
    notionPageId: actionPageId,
    externalId: actionExt,
    expectedLastEditedTime: await edited(notion, actionPageId),
    input: {
      title: `${PREFIX}_action`,
      customerPageId,
      dealPageId: dealPageId ?? null,
      activityPageId: null,
      staffPageId,
      dueDate: today,
      statusPageId: doneSt,
      priorityPageId: null,
      completedAt: today,
    },
  }).then(
    (r) => (r.status === "completed" ? ok("9_action_complete") : ng("9_action_complete", r.status)),
    (e) => ng("9_action_complete", e instanceof Error ? e.message.slice(0, 60) : "err"),
  );
  const { data: closed } = await admin
    .from("action_index")
    .select("is_open")
    .eq("notion_page_id", actionPageId)
    .maybeSingle();
  if (closed?.is_open === false) ok("9b_closed");
  else ng("9b_closed");

  // 10–11 contract + complaint + indexes
  const contract = await contractCreate({
    requestId: newRequestId(),
    actorId,
    actorName,
    input: {
      title: `${PREFIX}_contract`,
      customerPageId,
      dealPageId: dealPageId ?? null,
      contractTypePageId: null,
      tradeTypePageId: null,
      paymentStatusPageId: await master(admin, "支払状況"),
      statusPageId: await master(admin, "契約状態", "active"),
      staffPageIds: staffPageId ? [staffPageId] : [],
      amount: 10_000,
      contractedAt: today,
      startDate: today,
      endDate: null,
      autoRenew: false,
      billingTerms: null,
      contractUrl: null,
      note: "p9",
    },
  });
  if (contract.status === "completed" && contract.notionPageId) {
    ok("10_contract", mask(contract.notionPageId));
    const { data } = await admin
      .from("contract_index")
      .select("customer_page_id")
      .eq("notion_page_id", contract.notionPageId)
      .maybeSingle();
    if (data?.customer_page_id === customerPageId) ok("11_contract_index");
    else ng("11_contract_index");
  } else {
    ng("10_contract", contract.status);
    ng("11_contract_index");
  }

  const complaint = await complaintCreate({
    requestId: newRequestId(),
    actorId,
    actorName,
    input: {
      title: `${PREFIX}_complaint`,
      customerPageId,
      dealPageId: dealPageId ?? null,
      severityPageId: await master(admin, "クレーム重要度"),
      statusPageId: await master(admin, "クレーム対応状況", "open"),
      staffPageId,
      occurredOn: today,
      summary: "p9",
      dueDate: today,
      completedOn: null,
      note: null,
      content: "内容",
      cause: "原因",
      response: "対応",
      prevention: "防止",
    },
  });
  if (complaint.status === "completed" && complaint.notionPageId) {
    ok("10_complaint", mask(complaint.notionPageId));
    const { data } = await admin
      .from("complaint_index")
      .select("customer_page_id")
      .eq("notion_page_id", complaint.notionPageId)
      .maybeSingle();
    if (data?.customer_page_id === customerPageId) ok("11_complaint_index");
    else ng("11_complaint_index");
  } else {
    ng("10_complaint", complaint.status);
    ng("11_complaint_index");
  }

  // 12 rename via customerUpdate (webhook skipped)
  skip(
    "12_webhook_sync",
    "production Notion webhook_sync hard to isolate safely; customerUpdate→index used",
  );
  const { data: crow } = await admin
    .from("customer_index")
    .select(CUST_COLS)
    .eq("notion_page_id", customerPageId)
    .maybeSingle();
  const renamed = `${name}_upd`;
  const baseInput = fromIndex((crow ?? {}) as Record<string, unknown>, renamed);
  baseInput.staffPageIds = staffPageId ? [staffPageId] : [];
  const ren = await customerUpdate({
    requestId: newRequestId(),
    actorId,
    actorName,
    notionPageId: customerPageId,
    externalId: customerExt,
    expectedLastEditedTime: await edited(notion, customerPageId),
    input: baseInput,
  });
  if (ren.status === "completed") {
    const { data } = await admin
      .from("customer_index")
      .select("display_name")
      .eq("notion_page_id", customerPageId)
      .maybeSingle();
    if (data?.display_name === renamed) ok("12_rename_index");
    else ng("12_rename_index");
  } else ng("12_rename", ren.status);

  // optimistic lock
  let conflict = false;
  try {
    await customerUpdate({
      requestId: newRequestId(),
      actorId,
      actorName,
      notionPageId: customerPageId,
      externalId: customerExt,
      expectedLastEditedTime: "2000-01-01T00:00:00.000Z",
      input: { ...baseInput, displayName: `${renamed}_conflict` },
    });
  } catch (e) {
    conflict =
      (isCustomerSyncError(e) && e.code === "conflict") ||
      (e instanceof Error && /他の変更|conflict/i.test(e.message));
  }
  if (conflict) ok("optimistic_lock");
  else ng("optimistic_lock");
  const { data: intact } = await admin
    .from("customer_index")
    .select("display_name")
    .eq("notion_page_id", customerPageId)
    .maybeSingle();
  if (intact?.display_name === renamed) ok("optimistic_no_overwrite");
  else ng("optimistic_no_overwrite");

  // 13 CSV 1-row
  const csv = oneRowCsv();
  mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
  writeFileSync(resolve(process.cwd(), "tmp", `${PREFIX}.csv`), csv, "utf8");
  const importJobId = randomUUID();
  const upload = await createImportUploadUrl({
    userId: actorId,
    importJobId,
    fileName: `${PREFIX}.csv`,
    fileSize: Buffer.byteLength(csv, "utf8"),
    entityType: "customers",
    sourceSystem: SOURCE,
  });
  const put = await fetch(upload.signedUploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/csv" },
    body: csv,
  });
  if (put.ok) ok("13_csv_put");
  else ng("13_csv_put", `status=${put.status}`);
  const parsed = parseCsv(csv);
  await admin
    .from("import_jobs")
    .update({
      status: "mapping_required",
      detected_encoding: "utf-8",
      row_count: parsed.rows.length,
      column_mapping: suggestMapping(parsed.headers, "customers"),
      summary: { headers: parsed.headers },
      default_decision: "create",
    })
    .eq("id", importJobId);
  const staged = await validateAndStageImport({ importJobId, actorId, actorName });
  info("13_csv_stage", JSON.stringify(staged.summary));
  await admin.from("import_jobs").update({ status: "ready" }).eq("id", importJobId);
  await enqueueJob({
    kind: "csv_import",
    payload: { importJobId, mode: "import", actorId, actorName },
    idempotencyKey: `p9:${importJobId}`,
    createdBy: actorId,
    priority: 30,
  });
  let importStatus = "";
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await triggerJobs(10);
    const { data } = await admin
      .from("import_jobs")
      .select("status")
      .eq("id", importJobId)
      .maybeSingle();
    importStatus = String(data?.status ?? "");
    if (["completed", "partially_completed", "failed", "cancelled"].includes(importStatus)) {
      break;
    }
    await sleep(4000);
  }
  const { count: imported } = await admin
    .from("import_rows")
    .select("id", { count: "exact", head: true })
    .eq("import_job_id", importJobId)
    .eq("status", "imported");
  if ((imported ?? 0) >= 1 && importStatus !== "failed") {
    ok("13_csv_import", `status=${importStatus}`);
  } else ng("13_csv_import", `status=${importStatus} n=${imported ?? 0}`);

  // 14 cleanup
  if (contactPageId) {
    try {
      await contactUpdate({
        requestId: newRequestId(),
        actorId,
        actorName,
        notionPageId: contactPageId,
        externalId: contactExt,
        expectedLastEditedTime: await edited(notion, contactPageId),
        input: {
          name: `${PREFIX}_contact`,
          nameKana: null,
          customerPageId,
          department: "営業",
          title: null,
          phone: phone(2),
          email: null,
          contactTypePageId: null,
          note: null,
          isActive: false,
        },
      });
      ok("14_contact_deactivate");
    } catch (e) {
      ng("14_contact_deactivate", e instanceof Error ? e.message.slice(0, 50) : "err");
    }
  } else skip("14_contact_deactivate", "no contact");

  if (dealPageId && statusLost) {
    try {
      await dealUpdate({
        requestId: newRequestId(),
        actorId,
        actorName,
        notionPageId: dealPageId,
        externalId: dealExt,
        expectedLastEditedTime: await edited(notion, dealPageId),
        input: {
          title: `${PREFIX}_deal`,
          customerPageId,
          contactPageIds: contactPageId ? [contactPageId] : [],
          businessCategoryPageId: null,
          productName: "P9",
          stagePageId: null,
          staffPageIds: staffPageId ? [staffPageId] : [],
          expectedAmount: AMT,
          contractAmount: null,
          probability: 0,
          expectedCloseDate: null,
          contractedAt: null,
          periodStart: null,
          periodEnd: null,
          lostReason: "p9 cleanup",
          statusPageId: statusLost,
          note: "lost",
        },
      });
      ok("14_deal_lost");
    } catch (e) {
      ng("14_deal_lost", e instanceof Error ? e.message.slice(0, 50) : "err");
    }
  } else skip("14_deal_lost", "deal/lost missing");

  const { data: toArch } = await admin
    .from("customer_index")
    .select(CUST_COLS)
    .ilike("display_name", `${PREFIX}%`);
  let archived = 0;
  for (const c of toArch ?? []) {
    if (c.is_archived) {
      archived += 1;
      continue;
    }
    try {
      await customerUpdate({
        requestId: uuidV5(`p9:arch:${c.external_id}:${Date.now()}`),
        actorId,
        actorName,
        notionPageId: String(c.notion_page_id),
        externalId: String(c.external_id),
        expectedLastEditedTime: await edited(notion, String(c.notion_page_id)),
        input: {
          ...fromIndex(c as Record<string, unknown>, String(c.display_name)),
          isArchived: true,
        },
      });
      archived += 1;
      await triggerJobs(3);
    } catch (e) {
      info("archive_fail", e instanceof Error ? e.message.slice(0, 50) : "err");
    }
  }
  const total = (toArch ?? []).length;
  if (total > 0 && archived === total) ok("14_archive", `${archived}/${total}`);
  else ng("14_archive", `${archived}/${total}`);

  // 15 summary
  console.log(`\n## Summary ok=${okN} ng=${ngN} skip=${skipN}`);
  if (ngN > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[NG] fatal", e instanceof Error ? e.message.slice(0, 120) : "err");
  process.exit(1);
});
