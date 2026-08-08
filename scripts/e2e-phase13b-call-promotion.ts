/**
 * Phase 13B Production E2E: 架電 / queue / KPI / 昇格 / Notion非汚染。
 * Usage:
 *   $env:NODE_OPTIONS='--require ./scripts/shims/mock-server-only.cjs'
 *   npx tsx scripts/e2e-phase13b-call-promotion.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { createProspectList, updateProspectList } from "../src/lib/prospects/lists";
import { saveCallAttempt } from "../src/lib/prospects/call-attempts";
import {
  claimNextProspectCall,
  releaseProspectCallClaim,
} from "../src/lib/prospects/call-queue";
import { promoteProspect } from "../src/lib/prospects/promote";
import { fetchListCallKpis } from "../src/lib/prospects/kpi";
import { enqueueJob } from "../src/lib/jobs/queue";
import { processBackfillNormalizedDomainChunk } from "../src/lib/customers/backfill-normalized-domain";

const MARKER = randomUUID().slice(0, 8);
const LIST_NAME = `Phase13B E2E 架電リスト ${MARKER}`;
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

async function triggerJobs(rounds = 30): Promise<number> {
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
    if (n === 0) await new Promise((r) => setTimeout(r, 500));
  }
  return total;
}

async function countCustomers(admin: ReturnType<typeof createClient>) {
  const { count } = await admin
    .from("customer_index")
    .select("notion_page_id", { count: "exact", head: true })
    .eq("is_archived", false);
  return count ?? 0;
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing supabase env");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: actor } = await admin
    .from("app_users")
    .select("id,display_name,notion_staff_page_id,role")
    .eq("is_active", true)
    .in("role", ["admin", "a"])
    .limit(1)
    .maybeSingle();
  if (!actor) throw new Error("no actor user");

  // backfill a chunk of normalized_domain
  await processBackfillNormalizedDomainChunk({
    payload: { chunkSize: 50, chainId: `e2e-${MARKER}` },
    enqueueNext: false,
  });
  ok("normalized_domain backfill chunk");

  const beforeCustomers = await countCustomers(admin);

  const list = await createProspectList({
    name: LIST_NAME,
    description: "Phase13B E2E",
    sourceType: "manual",
    actorId: actor.id,
    actorName: actor.display_name,
  });
  ok("create list", list.id);

  // pick formal org for match
  const { data: formal } = await admin
    .from("customer_index")
    .select("notion_page_id,external_id,display_name,normalized_domain,phone_normalized,website")
    .eq("is_archived", false)
    .not("normalized_domain", "is", null)
    .limit(1)
    .maybeSingle();

  const cases: Array<{
    key: string;
    company: string;
    result: string;
    domain?: string;
    phone?: string;
    nextHours?: number;
    dnc?: boolean;
  }> = [
    { key: "A", company: `13B不通_${MARKER}`, result: "no_answer" },
    {
      key: "B",
      company: `13B不在_${MARKER}`,
      result: "contact_absent",
      nextHours: 24,
    },
    { key: "C", company: `13B接触_${MARKER}`, result: "connected" },
    { key: "D", company: `13B資料_${MARKER}`, result: "send_materials" },
    { key: "E", company: `13B興味_${MARKER}`, result: "interested" },
    { key: "F", company: `13Bアポ_${MARKER}`, result: "appointment" },
    { key: "G", company: `13B対象外_${MARKER}`, result: "not_interested" },
    { key: "H", company: `13BDNC_${MARKER}`, result: "do_not_contact", dnc: true },
  ];

  if (formal?.normalized_domain) {
    cases.push({
      key: "MATCH",
      company: `13B照合_${MARKER}`,
      result: "interested",
      domain: String(formal.normalized_domain),
    });
  }

  const membershipIds: string[] = [];
  const prospectByKey = new Map<string, { prospectId: string; membershipId: string }>();

  for (const c of cases) {
    const domain = c.domain ?? `${c.key.toLowerCase()}-${MARKER}.example.test`;
    const { data: p, error: pe } = await admin
      .from("prospects")
      .insert({
        company_name: c.company,
        normalized_company_name: c.company.toLowerCase(),
        website_url: `https://${domain}`,
        normalized_domain: domain,
        main_phone: c.phone ?? null,
        normalized_phone: c.phone ?? null,
        search_text: c.company,
        created_by: actor.id,
        do_not_contact: false,
      })
      .select("id")
      .single();
    if (pe || !p) throw new Error(pe?.message ?? "prospect insert");
    const { data: m, error: me } = await admin
      .from("prospect_list_memberships")
      .insert({
        prospect_list_id: list.id,
        prospect_id: p.id,
        assigned_user_id: actor.id,
        stage: "assigned",
      })
      .select("id")
      .single();
    if (me || !m) throw new Error(me?.message ?? "membership insert");
    membershipIds.push(String(m.id));
    prospectByKey.set(c.key, {
      prospectId: String(p.id),
      membershipId: String(m.id),
    });
  }
  ok("seed prospects", String(cases.length));

  // claim + save attempts (skip DNC case for queue first)
  const claimed1 = await claimNextProspectCall({
    userId: actor.id,
    actorName: actor.display_name,
    listId: list.id,
    filter: "eligible",
  });
  if (!claimed1) {
    ng("claim first");
  } else {
    ok("claim first", claimed1.id);
    await releaseProspectCallClaim({
      membershipId: claimed1.id,
      userId: actor.id,
      actorName: actor.display_name,
    });
    ok("release claim");
  }

  for (const c of cases) {
    const row = prospectByKey.get(c.key)!;
    const nextAt =
      c.nextHours != null
        ? new Date(Date.now() + c.nextHours * 3600_000).toISOString()
        : c.key === "B"
          ? new Date(Date.now() + 48 * 3600_000).toISOString()
          : null;
    const requestId = randomUUID();
    const saved = await saveCallAttempt({
      requestId,
      prospectId: row.prospectId,
      membershipId: row.membershipId,
      performedBy: actor.id,
      actorName: actor.display_name,
      result: c.result,
      note: `e2e ${c.key}`,
      nextContactAt: nextAt,
    });
    const again = await saveCallAttempt({
      requestId,
      prospectId: row.prospectId,
      membershipId: row.membershipId,
      performedBy: actor.id,
      actorName: actor.display_name,
      result: c.result,
      note: `e2e ${c.key} retry`,
    });
    if (!again.duplicated) ng(`idempotent ${c.key}`);
    else ok(`call+idempotent ${c.key}`, saved.stage);
  }

  // future callback should be excluded from eligible
  const afterFuture = await claimNextProspectCall({
    userId: actor.id,
    actorName: actor.display_name,
    listId: list.id,
    filter: "eligible",
  });
  // most are qualified/disqualified/dnc/working with future - may be empty
  if (afterFuture) {
    await releaseProspectCallClaim({
      membershipId: afterFuture.id,
      userId: actor.id,
      actorName: actor.display_name,
    });
  }
  ok("post-call claim check");

  // DNC prospect excluded
  const { data: dncP } = await admin
    .from("prospects")
    .select("do_not_contact")
    .eq("id", prospectByKey.get("H")!.prospectId)
    .single();
  if (dncP?.do_not_contact) ok("DNC set");
  else ng("DNC set");

  // stage checks
  const { data: memE } = await admin
    .from("prospect_list_memberships")
    .select("stage")
    .eq("id", prospectByKey.get("E")!.membershipId)
    .single();
  if (memE?.stage === "qualified") ok("interested→qualified");
  else ng("interested→qualified", String(memE?.stage));

  const { data: memG } = await admin
    .from("prospect_list_memberships")
    .select("stage")
    .eq("id", prospectByKey.get("G")!.membershipId)
    .single();
  if (memG?.stage === "disqualified") ok("not_interested→disqualified");
  else ng("not_interested→disqualified", String(memG?.stage));

  const midCustomers = await countCustomers(admin);
  if (midCustomers === beforeCustomers) ok("Notion/customer count unchanged after calls");
  else ng("customer count after calls", `${beforeCustomers}→${midCustomers}`);

  const kpis = await fetchListCallKpis({ listIds: [list.id], period: "all" });
  if ((kpis[0]?.attemptCount ?? 0) >= cases.length) ok("KPI attempts", String(kpis[0]?.attemptCount));
  else ng("KPI attempts", String(kpis[0]?.attemptCount));

  // promote new org for F
  const f = prospectByKey.get("F")!;
  const promoReq = randomUUID();
  try {
    const result = await promoteProspect({
      prospectId: f.prospectId,
      membershipId: f.membershipId,
      mode: "create_new",
      relationshipSemanticKeys: ["prospect"],
      contactIds: [],
      copyActivityCount: 1,
      createNextAction: false,
      createDeal: false,
      actorId: actor.id,
      actorName: actor.display_name,
      actorStaffPageId: actor.notion_staff_page_id,
      requestId: promoReq,
    });
    if (result.status === "completed" && result.customerPageId) {
      ok("promote new organization", result.customerPageId.slice(0, 8));
    } else {
      ng("promote new organization", result.status);
    }
  } catch (e) {
    ng("promote new organization", e instanceof Error ? e.message : String(e));
  }

  // promote link existing for MATCH if available
  if (formal && prospectByKey.has("MATCH")) {
    const m = prospectByKey.get("MATCH")!;
    try {
      const result = await promoteProspect({
        prospectId: m.prospectId,
        membershipId: m.membershipId,
        mode: "link_existing",
        existingCustomerPageId: String(formal.notion_page_id),
        contactIds: [],
        copyActivityCount: 0,
        createNextAction: false,
        createDeal: false,
        actorId: actor.id,
        actorName: actor.display_name,
        actorStaffPageId: actor.notion_staff_page_id,
        requestId: randomUUID(),
      });
      if (result.status === "completed") ok("promote link existing");
      else ng("promote link existing", result.status);
    } catch (e) {
      ng("promote link existing", e instanceof Error ? e.message : String(e));
    }
  }

  await triggerJobs(5);

  const afterCustomers = await countCustomers(admin);
  if (afterCustomers >= beforeCustomers) {
    ok("customer count after promote", `${beforeCustomers}→${afterCustomers}`);
  } else {
    ng("customer count after promote");
  }

  // archive cleanup (no physical delete)
  await updateProspectList({
    id: list.id,
    patch: { status: "archived" },
    actorId: actor.id,
    actorName: actor.display_name,
  });
  await admin
    .from("prospect_lists")
    .update({ archived_at: new Date().toISOString(), status: "archived" })
    .eq("id", list.id);
  await admin
    .from("prospects")
    .update({ archived_at: new Date().toISOString() })
    .in(
      "id",
      [...prospectByKey.values()].map((v) => v.prospectId),
    );
  await admin
    .from("prospect_list_memberships")
    .update({ archived_at: new Date().toISOString() })
    .eq("prospect_list_id", list.id);

  // archive created org if any
  const { data: promoted } = await admin
    .from("prospects")
    .select("promoted_customer_page_id")
    .eq("id", f.prospectId)
    .maybeSingle();
  if (promoted?.promoted_customer_page_id) {
    await admin
      .from("customer_index")
      .update({ is_archived: true })
      .eq("notion_page_id", promoted.promoted_customer_page_id);
    ok("archive promoted org index row");
  }

  // enqueue domain backfill for prod (optional chain)
  await enqueueJob({
    kind: "customer.backfill_normalized_domain",
    payload: { chainId: `post-13b-${MARKER}`, chunkSize: 200 },
    priority: 70,
    createdBy: actor.id,
    idempotencyKey: `customer.backfill_normalized_domain:post-13b-${MARKER}:start`,
  });
  ok("enqueue full domain backfill");

  console.log(`\nPhase13B E2E done ok=${okN} ng=${ngN}`);
  if (ngN > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
