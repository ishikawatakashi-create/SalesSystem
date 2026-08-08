/**
 * Phase 12 Production E2E: 組織（関係性 multi）+ CRM 回帰 + archive。
 * Never logs secrets / full UUIDs / PII.
 *
 * Usage:
 *   $env:NODE_OPTIONS='--require ./scripts/shims/mock-server-only.cjs'
 *   npx tsx scripts/e2e-phase12-organizations.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "@notionhq/client";

import { createNotionClient } from "../src/lib/notion/client-core";
import { SupabaseNotionRateLimiter } from "../src/lib/notion/rate-limiter-core";
import { newRequestId } from "../src/lib/notion/ids";
import { todayDateTokyo } from "../src/lib/normalize/date-tokyo";
import { customerCreate, customerUpdate } from "../src/lib/sync/write-pipeline";
import { contactCreate } from "../src/lib/sync/contact-write-pipeline";
import { dealCreate } from "../src/lib/sync/deal-write-pipeline";
import { activityCreate } from "../src/lib/sync/activity-write-pipeline";
import { actionCreate } from "../src/lib/sync/action-write-pipeline";
import { resolveRelationshipPageIdsBySemanticKeys } from "../src/lib/organizations/resolve-relationship-semantics";
import { hasPermission } from "../src/lib/auth/permissions";
import type { CustomerWriteInput } from "../src/lib/customers/types";
import { notionPageToCustomer } from "../src/lib/notion/converters/customer";
import { loadCustomerPropertyMap } from "../src/lib/sync/write-pipeline";
import { SEARCH_ENTITY_LABELS } from "../src/lib/search/types";

const MARKER = crypto.randomUUID().slice(0, 8);
const DISPLAY_NAME = `Phase12 組織テスト ${MARKER}`;
const BASE =
  process.env.PRODUCTION_BASE_URL?.replace(/\/$/, "") ||
  "https://sales-system-weld.vercel.app";

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
function ok(s: string, d?: string) {
  okN += 1;
  console.log(`[OK] ${s}${d ? `: ${d}` : ""}`);
}
function ng(s: string, d?: string) {
  ngN += 1;
  console.error(`[NG] ${s}${d ? `: ${d}` : ""}`);
}
function info(s: string, d?: string) {
  console.log(`[INFO] ${s}${d ? `: ${d}` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function triggerJobs(rounds = 8): Promise<number> {
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
    await sleep(400);
  }
  return total;
}

async function master(
  admin: ReturnType<typeof createClient>,
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

function baseCustomerInput(
  relationshipPageIds: string[],
  staffPageId: string | null,
): CustomerWriteInput {
  return {
    displayName: DISPLAY_NAME,
    legalName: `Phase12法人_${MARKER}`,
    officeName: null,
    postalCode: null,
    prefecture: "東京都",
    city: "港区",
    addressLine: `Phase12町${MARKER}`,
    phone: null,
    email: null,
    representativeName: null,
    website: null,
    businessCategoryPageIds: [],
    tagPageIds: [],
    relationshipPageIds,
    salesStatusPageId: null,
    acquisitionRoutePageId: null,
    priorityPageId: null,
    staffPageIds: staffPageId ? [staffPageId] : [],
    relatedAccountPageIds: [],
    isArchived: false,
  };
}

async function waitIndexKeys(
  admin: ReturnType<typeof createClient>,
  pageId: string,
  expected: string[],
): Promise<string[] | null> {
  for (let i = 0; i < 20; i += 1) {
    await triggerJobs(3);
    const { data } = await admin
      .from("customer_index")
      .select("relationship_semantic_keys,relationship_ids,display_name,is_archived")
      .eq("notion_page_id", pageId)
      .maybeSingle();
    const keys = (data?.relationship_semantic_keys as string[] | null) ?? [];
    if (expected.every((k) => keys.includes(k)) && keys.length >= expected.length) {
      return keys;
    }
    await sleep(1000);
  }
  return null;
}

async function main() {
  loadEnvLocal();
  info("marker", MARKER);
  info("display", DISPLAY_NAME);

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

  // /customers → /organizations compat (unauthenticated redirect chain)
  {
    const res = await fetch(`${BASE}/customers`, {
      method: "GET",
      redirect: "manual",
    });
    const loc = res.headers.get("location") ?? "";
    if (
      res.status >= 300 &&
      res.status < 400 &&
      (loc.includes("/organizations") || loc.includes("/login"))
    ) {
      ok("customers_redirect_compat", `status=${res.status}`);
    } else {
      ng("customers_redirect_compat", `status=${res.status} loc=${loc.slice(0, 80)}`);
    }
  }
  {
    const res = await fetch(`${BASE}/organizations`, {
      method: "GET",
      redirect: "manual",
    });
    if (res.status === 200 || (res.status >= 300 && res.status < 400)) {
      ok("organizations_route", `status=${res.status}`);
    } else {
      ng("organizations_route", `status=${res.status}`);
    }
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // backfill: 関係性空は0。既存（非E2E）は customer を持つ
  {
    const { count: total } = await admin
      .from("customer_index")
      .select("notion_page_id", { count: "exact", head: true });
    const { count: empty } = await admin
      .from("customer_index")
      .select("notion_page_id", { count: "exact", head: true })
      .filter("relationship_ids", "eq", "{}");
    const { count: withCustomer } = await admin
      .from("customer_index")
      .select("notion_page_id", { count: "exact", head: true })
      .contains("relationship_semantic_keys", ["customer"]);
    const { count: phase12E2e } = await admin
      .from("customer_index")
      .select("notion_page_id", { count: "exact", head: true })
      .ilike("display_name", "Phase12 組織テスト%");
    const legacy = (total ?? 0) - (phase12E2e ?? 0);
    if ((empty ?? -1) === 0 && (withCustomer ?? 0) >= legacy && legacy >= 0) {
      ok(
        "backfill_all_customer",
        `total=${total} legacy=${legacy} withCustomer=${withCustomer} e2e=${phase12E2e}`,
      );
    } else {
      ng(
        "backfill_all_customer",
        `total=${total} empty=${empty} withCustomer=${withCustomer} legacy=${legacy}`,
      );
    }
  }

  const { data: actor } = await admin
    .from("app_users")
    .select("id,display_name,notion_staff_page_id,role")
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

  if (!hasPermission("viewer", "customer.edit")) {
    ok("14_viewer_no_edit");
  } else {
    ng("14_viewer_no_edit");
  }
  if (hasPermission("viewer", "customer.view")) {
    ok("14_viewer_can_view");
  } else {
    ng("14_viewer_can_view");
  }

  const relIds = await resolveRelationshipPageIdsBySemanticKeys(admin, [
    "media",
    "prospect",
  ]);
  if (relIds.length !== 2) {
    ng("relationship_masters", `ids=${relIds.length}`);
    process.exit(1);
  }
  ok("relationship_masters", "media+prospect");

  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN!,
    rateLimiter: new SupabaseNotionRateLimiter({
      createClient: () => admin as never,
    }),
    defaultPriority: "interactive",
  });

  const create = await customerCreate({
    requestId: newRequestId(),
    actorId,
    actorName,
    externalId: newRequestId(),
    input: baseCustomerInput(relIds, staffPageId),
  });
  if (create.status !== "completed" || !create.notionPageId) {
    ng("create_org", create.status);
    process.exit(1);
  }
  const pageId = create.notionPageId;
  ok("create_org", mask(pageId));

  const keys = await waitIndexKeys(admin, pageId, ["media", "prospect"]);
  if (!keys) {
    ng("11_index_semantic_keys");
  } else {
    ok("11_index_semantic_keys", keys.sort().join(","));
    if (keys.length >= 2) ok("4_relationship_badges", `n=${keys.length}`);
    else ng("4_relationship_badges", `n=${keys.length}`);
  }

  // 1 list presence / 2 media filter / 3 prospect filter
  {
    const { data: all } = await admin
      .from("customer_index")
      .select("notion_page_id")
      .eq("notion_page_id", pageId)
      .maybeSingle();
    if (all) ok("1_organizations_list");
    else ng("1_organizations_list");

    const { data: media } = await admin
      .from("customer_index")
      .select("notion_page_id")
      .contains("relationship_semantic_keys", ["media"])
      .eq("notion_page_id", pageId)
      .maybeSingle();
    if (media) ok("2_media_filter");
    else ng("2_media_filter");

    const { data: prospect } = await admin
      .from("customer_index")
      .select("notion_page_id")
      .contains("relationship_semantic_keys", ["prospect"])
      .eq("notion_page_id", pageId)
      .maybeSingle();
    if (prospect) ok("3_prospect_filter");
    else ng("3_prospect_filter");
  }

  // 10 Notion relation
  {
    const propertiesByName = await loadCustomerPropertyMap(admin);
    const page = await notion.pages.retrieve({ page_id: pageId });
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
    const notionRels = customer.relationshipPageIds ?? [];
    if (
      relIds.every((id) => notionRels.includes(id)) &&
      notionRels.length >= 2
    ) {
      ok("10_notion_relation", `n=${notionRels.length}`);
    } else {
      ng("10_notion_relation", `n=${notionRels.length}`);
    }
  }

  // 5 contact
  const contact = await contactCreate({
    requestId: newRequestId(),
    actorId,
    actorName,
    externalId: newRequestId(),
    input: {
      name: `Phase12担当_${MARKER}`,
      nameKana: null,
      customerPageId: pageId,
      department: "編集部",
      title: null,
      phone: null,
      email: null,
      contactTypePageId: null,
      note: null,
      isActive: true,
    },
  });
  if (contact.status === "completed" && contact.notionPageId) {
    ok("5_contact", mask(contact.notionPageId));
  } else {
    ng("5_contact", contact.status);
  }

  // 6 activity
  const activity = await activityCreate({
    requestId: newRequestId(),
    actorId,
    actorName,
    input: {
      title: `Phase12活動_${MARKER}`,
      customerPageId: pageId,
      dealPageId: null,
      contactPageIds: contact.notionPageId ? [contact.notionPageId] : [],
      activityAt: new Date().toISOString(),
      categoryPageIds: [],
      summary: "phase12 e2e",
      nextActionNote: null,
      nextActionDate: null,
      body: "phase12",
      batchId: null,
    },
  });
  if (activity.status === "completed" && activity.notionPageId) {
    ok("6_activity", mask(activity.notionPageId));
  } else {
    ng("6_activity", activity.status);
  }

  // 7 next action
  const openSt = await master(admin, "アクション状態", "open");
  if (!openSt) {
    ng("7_next_action", "missing open status master");
  }
  const action = await actionCreate({
    requestId: newRequestId(),
    actorId,
    actorName,
    externalId: newRequestId(),
    input: {
      title: `Phase12対応_${MARKER}`,
      customerPageId: pageId,
      dealPageId: null,
      activityPageId: activity.notionPageId ?? null,
      staffPageId,
      dueDate: todayDateTokyo(),
      statusPageId: openSt,
      priorityPageId: null,
      completedAt: null,
    },
  });
  if (action.status === "completed" && action.notionPageId) {
    ok("7_next_action", mask(action.notionPageId));
  } else {
    ng("7_next_action", action.status);
  }

  // 8 deal
  const statusActive = await master(admin, "案件ステータス", "active");
  const deal = await dealCreate({
    requestId: newRequestId(),
    actorId,
    actorName,
    externalId: newRequestId(),
    input: {
      title: `Phase12案件_${MARKER}`,
      customerPageId: pageId,
      contactPageIds: contact.notionPageId ? [contact.notionPageId] : [],
      businessCategoryPageId: null,
      productName: "P12",
      stagePageId: null,
      staffPageIds: staffPageId ? [staffPageId] : [],
      expectedAmount: 12000,
      contractAmount: null,
      probability: 40,
      expectedCloseDate: null,
      contractedAt: null,
      periodStart: null,
      periodEnd: null,
      lostReason: null,
      statusPageId: statusActive,
      note: "phase12",
    },
  });
  if (deal.status === "completed" && deal.notionPageId) {
    ok("8_deal", mask(deal.notionPageId));
  } else {
    ng("8_deal", deal.status);
  }

  // 9 global search（session 不要: index + href/label 規約）
  {
    const { data } = await admin
      .from("customer_index")
      .select("display_name,relationship_semantic_keys")
      .eq("notion_page_id", pageId)
      .ilike("display_name", `%Phase12%`)
      .maybeSingle();
    const href = `/organizations/${pageId}`;
    const labelOk = SEARCH_ENTITY_LABELS.customers === "組織";
    if (
      data?.display_name &&
      labelOk &&
      href.startsWith("/organizations/") &&
      ((data.relationship_semantic_keys as string[]) ?? []).includes("media")
    ) {
      ok("9_global_search", "index+org_label");
    } else {
      ng(
        "9_global_search",
        `label=${SEARCH_ENTITY_LABELS.customers} hit=${Boolean(data)}`,
      );
    }
  }

  // 12 webhook / write pipeline: write_operations + job worker reachable
  {
    const processed = await triggerJobs(6);
    const { data: wos, error: woErr } = await admin
      .from("write_operations")
      .select("request_id,status")
      .eq("notion_page_id", pageId)
      .eq("status", "completed")
      .limit(5);
    const { count: whEvents } = await admin
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
    if (!woErr && (wos?.length ?? 0) > 0) {
      ok(
        "12_webhook_pipeline",
        `wo=${wos!.length} jobs=${processed} wh_15m=${whEvents ?? 0}`,
      );
    } else {
      ng(
        "12_webhook_pipeline",
        `wo=${wos?.length ?? 0} err=${woErr?.message?.slice(0, 60) ?? ""}`,
      );
    }
  }

  // 13 audit
  {
    const { data: rows } = await admin
      .from("audit_logs")
      .select("id,action,entity_type,changed_fields")
      .eq("notion_page_id", pageId)
      .order("created_at", { ascending: false })
      .limit(20);
    if ((rows ?? []).length > 0) ok("13_audit", `n=${rows!.length}`);
    else ng("13_audit");
  }

  // archive (no physical delete)
  {
    const { data: row } = await admin
      .from("customer_index")
      .select("*")
      .eq("notion_page_id", pageId)
      .maybeSingle();
    if (!row) {
      ng("archive_load");
    } else {
      const page = await notion.pages.retrieve({ page_id: pageId });
      const lastEdited = (page as { last_edited_time: string }).last_edited_time;
      const propertiesByName = await loadCustomerPropertyMap(admin);
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
      const upd = await customerUpdate({
        requestId: newRequestId(),
        actorId,
        actorName,
        notionPageId: pageId,
        externalId: customer.externalId || String(row.external_id),
        expectedLastEditedTime: lastEdited,
        input: {
          ...baseCustomerInput(customer.relationshipPageIds, staffPageId),
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
          relationshipPageIds: customer.relationshipPageIds,
          salesStatusPageId: customer.salesStatusPageId,
          acquisitionRoutePageId: customer.acquisitionRoutePageId,
          priorityPageId: customer.priorityPageId,
          staffPageIds: customer.staffPageIds,
          relatedAccountPageIds: customer.relatedAccountPageIds,
          isArchived: true,
        },
      });
      if (upd.status === "completed") {
        const keysAfter = await waitIndexKeys(admin, pageId, ["media", "prospect"]);
        const { data: archived } = await admin
          .from("customer_index")
          .select("is_archived")
          .eq("notion_page_id", pageId)
          .maybeSingle();
        if (archived?.is_archived === true) {
          ok("archive_inactive", keysAfter ? "keys_kept" : "archived");
        } else {
          ng("archive_inactive", `is_archived=${archived?.is_archived}`);
        }
      } else {
        ng("archive_inactive", upd.status);
      }
    }
  }

  console.log(`\nSUMMARY ok=${okN} ng=${ngN} page=${mask(pageId)}`);
  if (ngN > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
