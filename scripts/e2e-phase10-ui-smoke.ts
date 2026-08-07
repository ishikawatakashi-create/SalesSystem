/**
 * Phase 10 Production UI smoke: QuickActivity on customer + IME helper unit already covered.
 * Uses test_phase10_ui_ prefix. No secrets/PII/full UUIDs in logs.
 *
 * $env:NODE_OPTIONS='--require ./scripts/shims/mock-server-only.cjs'; npx tsx scripts/e2e-phase10-ui-smoke.ts
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Client as NotionSdk } from "@notionhq/client";
import { customerCreate, customerUpdate } from "../src/lib/sync/write-pipeline";
import { contactCreate } from "../src/lib/sync/contact-write-pipeline";
import { dealCreate } from "../src/lib/sync/deal-write-pipeline";
import { activityCreate } from "../src/lib/sync/activity-write-pipeline";
import { titleFromActivityBody, shouldSubmitOnEnter } from "../src/lib/activities/quick-title";
import { uuidV5 } from "../src/lib/notion/ids";
import { createNotionClient } from "../src/lib/notion/client-core";
import { SupabaseNotionRateLimiter } from "../src/lib/notion/rate-limiter-core";

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
loadEnvLocal();

const PREFIX = `test_phase10_ui_${randomUUID().slice(0, 8)}`;
let okN = 0;
let ngN = 0;
function ok(s: string, d?: string) {
  okN += 1;
  console.log(`[OK] ${s}${d ? `: ${d}` : ""}`);
}
function ng(s: string, d?: string) {
  ngN += 1;
  console.error(`[NG] ${s}${d ? `: ${d}` : ""}`);
}
function mask(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : "[id]";
}

async function main() {
  // unit-like IME checks (also in vitest)
  if (
    !shouldSubmitOnEnter({
      key: "Enter",
      shiftKey: false,
      isComposing: true,
    })
  ) {
    ok("ime_composing_blocks");
  } else ng("ime_composing_blocks");
  if (
    shouldSubmitOnEnter({ key: "Enter", shiftKey: false, isComposing: false })
  ) {
    ok("enter_submits");
  } else ng("enter_submits");
  if (
    !shouldSubmitOnEnter({ key: "Enter", shiftKey: true, isComposing: false })
  ) {
    ok("shift_enter_newline");
  } else ng("shift_enter_newline");
  const t = titleFromActivityBody("電話にて導入時期を確認。\n続き");
  if (t.startsWith("電話にて")) ok("title_from_body");
  else ng("title_from_body");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: actor } = await admin
    .from("app_users")
    .select("id,display_name")
    .eq("role", "admin")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!actor) throw new Error("no admin");

  const limiter = new SupabaseNotionRateLimiter({
    supabase: admin as never,
  });
  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN!,
    rateLimiter: limiter,
  });
  void notion;

  const req = randomUUID();
  const created = await customerCreate({
    requestId: req,
    actorId: String(actor.id),
    actorName: String(actor.display_name ?? "admin"),
    input: {
      displayName: `${PREFIX}_cust`,
      legalName: `架空法人_${PREFIX}`,
      officeName: "本社",
      postalCode: null,
      prefecture: "東京都",
      city: "千代田区",
      addressLine: "1-1",
      phone: "090-1010-2020",
      email: `${PREFIX}@example.test`,
      representativeName: null,
      website: null,
      businessCategoryPageIds: [],
      tagPageIds: [],
      salesStatusPageId: null,
      acquisitionRoutePageId: null,
      priorityPageId: null,
      staffPageIds: [],
      relatedAccountPageIds: [],
      isArchived: false,
    },
  });
  if (!created.notionPageId) throw new Error("customer create failed");
  ok("customer", mask(created.notionPageId));

  const body =
    "電話にて導入時期を確認。9月頃を予定。Phase10 quick composer path.";
  const title = titleFromActivityBody(body);
  const actReq = randomUUID();
  const actInput = {
    title,
    customerPageId: created.notionPageId,
    dealPageId: null as string | null,
    contactPageIds: [] as string[],
    activityAt: new Date().toISOString(),
    categoryPageIds: [] as string[],
    summary: null as string | null,
    nextActionNote: null as string | null,
    nextActionDate: null as string | null,
    body,
    batchId: null as string | null,
  };
  const act = await activityCreate({
    requestId: actReq,
    actorId: String(actor.id),
    actorName: String(actor.display_name ?? "admin"),
    input: actInput,
  });
  if (act.notionPageId) ok("quick_activity_pipeline", mask(act.notionPageId));
  else ng("quick_activity_pipeline");

  // 同一 request_id + 同一入力で冪等再実行
  const again = await activityCreate({
    requestId: actReq,
    actorId: String(actor.id),
    actorName: String(actor.display_name ?? "admin"),
    input: actInput,
  });
  if (again.notionPageId === act.notionPageId) ok("idempotent_request_id");
  else ng("idempotent_request_id");

  const { count } = await admin
    .from("activity_index")
    .select("notion_page_id", { count: "exact", head: true })
    .eq("customer_page_id", created.notionPageId)
    .ilike("title", "電話にて%");
  if ((count ?? 0) >= 1) ok("activity_index");
  else ng("activity_index");

  const actorId = String(actor.id);
  const actorName = String(actor.display_name ?? "admin");

  // 案件コンテキスト（customer + deal）
  const contact = await contactCreate({
    requestId: randomUUID(),
    actorId,
    actorName,
    input: {
      name: `${PREFIX}_contact`,
      nameKana: null,
      customerPageId: created.notionPageId,
      department: "営業",
      title: null,
      phone: "090-5050-6060",
      email: null,
      contactTypePageId: null,
      note: null,
      isActive: true,
    },
  });
  if (contact.notionPageId) ok("contact", mask(contact.notionPageId));
  else ng("contact");

  const { data: statusRow } = await admin
    .from("masters_cache")
    .select("notion_page_id")
    .eq("master_type", "案件ステータス")
    .eq("semantic_key", "active")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const statusActiveId =
    (statusRow?.notion_page_id as string | undefined) ?? null;

  const deal = await dealCreate({
    requestId: randomUUID(),
    actorId,
    actorName,
    input: {
      title: `${PREFIX}_deal`,
      customerPageId: created.notionPageId,
      contactPageIds: contact.notionPageId ? [contact.notionPageId] : [],
      businessCategoryPageId: null,
      productName: "P10",
      stagePageId: null,
      staffPageIds: [],
      expectedAmount: 12000,
      contractAmount: null,
      probability: 50,
      expectedCloseDate: null,
      contractedAt: null,
      periodStart: null,
      periodEnd: null,
      lostReason: null,
      statusPageId: statusActiveId,
      note: "p10",
    },
  });
  if (deal.notionPageId) ok("deal", mask(deal.notionPageId));
  else ng("deal");

  if (deal.notionPageId) {
    const bodyDeal = `案件詳細から電話メモ。${PREFIX}`;
    const actDeal = await activityCreate({
      requestId: randomUUID(),
      actorId,
      actorName,
      input: {
        title: titleFromActivityBody(bodyDeal),
        customerPageId: created.notionPageId,
        dealPageId: deal.notionPageId,
        contactPageIds: [],
        activityAt: new Date().toISOString(),
        categoryPageIds: [],
        summary: null,
        nextActionNote: null,
        nextActionDate: null,
        body: bodyDeal,
        batchId: null,
      },
    });
    const { data: rowDeal } = await admin
      .from("activity_index")
      .select("customer_page_id,deal_page_id")
      .eq("notion_page_id", actDeal.notionPageId!)
      .maybeSingle();
    if (
      rowDeal?.customer_page_id === created.notionPageId &&
      rowDeal?.deal_page_id === deal.notionPageId
    ) {
      ok("deal_context_relations");
    } else ng("deal_context_relations");
  }

  if (contact.notionPageId) {
    const bodyContact = `担当者詳細から電話メモ。${PREFIX}`;
    const actContact = await activityCreate({
      requestId: randomUUID(),
      actorId,
      actorName,
      input: {
        title: titleFromActivityBody(bodyContact),
        customerPageId: created.notionPageId,
        dealPageId: null,
        contactPageIds: [contact.notionPageId],
        activityAt: new Date().toISOString(),
        categoryPageIds: [],
        summary: null,
        nextActionNote: null,
        nextActionDate: null,
        body: bodyContact,
        batchId: null,
      },
    });
    const { data: rowContact } = await admin
      .from("activity_index")
      .select("customer_page_id,contact_page_ids")
      .eq("notion_page_id", actContact.notionPageId!)
      .maybeSingle();
    const contactsOk =
      Array.isArray(rowContact?.contact_page_ids) &&
      rowContact!.contact_page_ids.includes(contact.notionPageId);
    if (rowContact?.customer_page_id === created.notionPageId && contactsOk) {
      ok("contact_context_relations");
    } else ng("contact_context_relations");
  }

  // archive
  const sdk = new NotionSdk({ auth: process.env.NOTION_TOKEN! });
  const page = await sdk.pages.retrieve({ page_id: created.notionPageId });
  const edited = (page as { last_edited_time: string }).last_edited_time;
  await customerUpdate({
    requestId: uuidV5(`p10:arch:${created.externalId}`),
    actorId,
    actorName,
    notionPageId: created.notionPageId,
    externalId: created.externalId,
    expectedLastEditedTime: edited,
    input: {
      displayName: `${PREFIX}_cust`,
      legalName: `架空法人_${PREFIX}`,
      officeName: "本社",
      postalCode: null,
      prefecture: "東京都",
      city: "千代田区",
      addressLine: "1-1",
      phone: "090-1010-2020",
      email: `${PREFIX}@example.test`,
      representativeName: null,
      website: null,
      businessCategoryPageIds: [],
      tagPageIds: [],
      salesStatusPageId: null,
      acquisitionRoutePageId: null,
      priorityPageId: null,
      staffPageIds: [],
      relatedAccountPageIds: [],
      isArchived: true,
    },
  });
  ok("archived");

  console.log(`\n## Summary ok=${okN} ng=${ngN} prefix=${PREFIX}_*`);
  if (ngN > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.slice(0, 120) : e);
  process.exit(1);
});
