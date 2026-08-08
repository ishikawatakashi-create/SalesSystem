/**
 * Phase 13A Production E2E: Prospect Pool CSV / dedupe / assign / DNC / Notion非汚染。
 * Usage:
 *   $env:NODE_OPTIONS='--require ./scripts/shims/mock-server-only.cjs'
 *   npx tsx scripts/e2e-phase13a-prospect-pool.ts
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { createProspectList } from "../src/lib/prospects/lists";
import { updateProspectList } from "../src/lib/prospects/lists";
import {
  prepareProspectImport,
  stageAndEnqueueProspectImport,
  createProspectImportUpload,
  processProspectImportChunk,
} from "../src/lib/prospects/import";
import { bulkAssignMemberships } from "../src/lib/prospects/memberships";
import { setMembershipStage } from "../src/lib/prospects/memberships";
import { setProspectDoNotContact } from "../src/lib/prospects/dnc";

const MARKER = crypto.randomUUID().slice(0, 8);
const LIST_NAME = `Phase13A E2E 営業リスト ${MARKER}`;
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

function mask(id: string): string {
  return id.length < 12 ? "[id]" : `${id.slice(0, 8)}…${id.slice(-4)}`;
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

async function triggerJobs(rounds = 20): Promise<number> {
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
    if (n === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return total;
}

function buildCsv(formalDomain: string | null): string {
  const domainA = `a-${MARKER}.example.test`;
  const domainB = `b-${MARKER}.example.test`;
  const domainC = `c-${MARKER}.example.test`;
  const phoneB = `0311${MARKER.replace(/\D/g, "").padEnd(6, "0").slice(0, 6)}`;
  const emailC = `contact-${MARKER}@c-${MARKER}.example.test`;
  const sameNameOther = `同名別会社-${MARKER}`;
  const rows = [
    ["会社名", "Webサイト", "電話", "都道府県", "市区町村", "担当者名", "担当者メール", "担当者電話", "外部レコードID", "ブース番号", "メモ"],
    [`Phase13A会社A_${MARKER}`, `https://www.${domainA}`, "", "神奈川県", "横浜市", "担当A", "", "", `EXT-A-${MARKER}`, "B-1", "新規A"],
    [`Phase13A会社B_${MARKER}`, `https://${domainB}`, phoneB, "東京都", "港区", "担当B", "", "", `EXT-B-${MARKER}`, "", "新規B"],
    [`Phase13A会社C_${MARKER}`, `https://${domainC}`, "", "大阪府", "大阪市", "担当C1", emailC, "", `EXT-C-${MARKER}`, "", "新規C"],
    [`Phase13A会社A再利用_${MARKER}`, `https://${domainA}`, "", "神奈川県", "川崎市", "担当A2", "", "", `EXT-A2-${MARKER}`, "B-2", "同domain"],
    [`Phase13A会社B電話再利用_${MARKER}`, "", phoneB, "東京都", "中央区", "担当B2", "", "", `EXT-B2-${MARKER}`, "", "同phone"],
    [`Phase13A会社Cメール再利用_${MARKER}`, "", "", "大阪府", "堺市", "担当C2", emailC, "", `EXT-C2-${MARKER}`, "", "同email"],
    [sameNameOther, `https://other-${MARKER}.example.test`, "", "北海道", "札幌市", "担当X", "", "", `EXT-N-${MARKER}`, "", "同名別domain"],
    [`Phase13A複連絡_${MARKER}`, `https://multi-${MARKER}.example.test`, "", "福岡県", "福岡市", "担当1", `p1-${MARKER}@example.test`, "", `EXT-M1-${MARKER}`, "", "contact1"],
    ["", "https://invalid.example.test", "", "", "", "", "", "", "", "", "invalid no company"],
    [`Phase13A_DNC_${MARKER}`, `https://dnc-${MARKER}.example.test`, "", "愛知県", "名古屋市", "担当D", "", "", `EXT-DNC-${MARKER}`, "", "dnc"],
    [
      `Phase13A_FORMAL_${MARKER}`,
      formalDomain ? `https://${formalDomain}` : `https://noformal-${MARKER}.example.test`,
      "",
      "東京都",
      "千代田区",
      "担当F",
      "",
      "",
      `EXT-F-${MARKER}`,
      "SCORE:9",
      "formal match",
    ],
    [`Phase13A複連絡_${MARKER}`, `https://multi-${MARKER}.example.test`, "", "福岡県", "福岡市", "担当2", `p2-${MARKER}@example.test`, "09011112222", `EXT-M2-${MARKER}`, "", "contact2 same company"],
  ];
  return rows.map((r) => r.map((c) => (c.includes(",") ? `"${c}"` : c)).join(",")).join("\r\n") + "\r\n";
}

async function main() {
  loadEnvLocal();
  console.log(`[INFO] marker=${MARKER}`);

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );

  const { count: orgBefore } = await admin
    .from("customer_index")
    .select("notion_page_id", { count: "exact", head: true });

  const { data: actor } = await admin
    .from("app_users")
    .select("id,display_name")
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
  ok("actor", mask(actorId));

  const { data: formal } = await admin
    .from("customer_index")
    .select("website,email,display_name")
    .eq("is_archived", false)
    .not("website", "is", null)
    .limit(20);
  let formalDomain: string | null = null;
  for (const row of formal ?? []) {
    const w = String(row.website ?? "");
    const m = w.match(/https?:\/\/(?:www\.)?([^/:]+)/i);
    if (m?.[1] && m[1].includes(".")) {
      formalDomain = m[1].toLowerCase().replace(/^www\./, "");
      break;
    }
  }

  const list = await createProspectList({
    name: LIST_NAME,
    sourceType: "csv",
    sourceName: "phase13a_e2e",
    actorId,
    actorName,
  });
  ok("list_create", mask(list.id));

  const csv = buildCsv(formalDomain);
  mkdirSync(resolve("tmp"), { recursive: true });
  const csvPath = resolve(`tmp/phase13a_e2e_${MARKER}.csv`);
  writeFileSync(csvPath, csv, "utf8");

  const upload = await createProspectImportUpload({
    userId: actorId,
    listId: list.id,
    fileName: `phase13a_${MARKER}.csv`,
    fileSize: Buffer.byteLength(csv),
  });

  const put = await fetch(upload.signedUploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/csv" },
    body: csv,
  });
  if (!put.ok) {
    ng("upload", String(put.status));
    process.exit(1);
  }
  ok("upload");

  const prepared = await prepareProspectImport({
    importJobId: upload.importJobId,
  });
  const mapping = prepared.mapping;
  if (!mapping.companyName) {
    ng("mapping");
    process.exit(1);
  }
  ok("mapping", `rows=${prepared.totalRows}`);

  await stageAndEnqueueProspectImport({
    importJobId: upload.importJobId,
    mapping,
    actorId,
    actorName,
  });

  // Process locally to avoid waiting only on Vercel (also exercises chunk)
  let cursor = 0;
  for (let i = 0; i < 20; i += 1) {
    const chunk = await processProspectImportChunk({
      importJobId: upload.importJobId,
      listId: list.id,
      cursorRowNumber: cursor,
      actorId,
      actorName,
      enqueueNext: false,
    });
    cursor = chunk.nextCursor;
    if (chunk.done) break;
  }
  await triggerJobs(8);

  const { data: job } = await admin
    .from("prospect_import_jobs")
    .select("*")
    .eq("id", upload.importJobId)
    .single();
  ok(
    "import_counts",
    `accepted=${job?.accepted_count} reused=${job?.reused_count} probable=${job?.probable_duplicate_count} invalid=${job?.invalid_count} skipped=${job?.skipped_count}`,
  );

  if ((job?.invalid_count ?? 0) >= 1) ok("invalid_row");
  else ng("invalid_row");

  const { data: mems } = await admin
    .from("prospect_list_memberships")
    .select("id,prospect_id,stage,assigned_user_id,source_attributes")
    .eq("prospect_list_id", list.id)
    .is("archived_at", null);
  const prospectIds = [...new Set((mems ?? []).map((m) => m.prospect_id))];
  // high-confidence reuse should keep prospect count < membership-ish unique companies
  if (prospectIds.length < (mems ?? []).length) {
    ok("dedupe_reuse", `prospects=${prospectIds.length} mems=${mems?.length}`);
  } else {
    // still ok if skipped hashes; check domain reuse specifically
    const { count: domainDup } = await admin
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("normalized_domain", `a-${MARKER}.example.test`)
      .is("archived_at", null);
    if ((domainDup ?? 0) === 1) ok("dedupe_reuse", "domain");
    else ng("dedupe_reuse", `domain=${domainDup}`);
  }

  // same name different domain → 2 prospects
  const { count: sameName } = await admin
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .ilike("company_name", `%同名別会社-${MARKER}%`)
    .is("archived_at", null);
  if ((sameName ?? 0) === 1) ok("no_merge_name_only");
  else ng("no_merge_name_only", `n=${sameName}`);

  // contacts for multi company
  const { data: multi } = await admin
    .from("prospects")
    .select("id")
    .ilike("company_name", `%Phase13A複連絡_${MARKER}%`)
    .is("archived_at", null)
    .maybeSingle();
  if (multi) {
    const { count: ccount } = await admin
      .from("prospect_contacts")
      .select("id", { count: "exact", head: true })
      .eq("prospect_id", multi.id)
      .is("archived_at", null);
    if ((ccount ?? 0) >= 2) ok("multi_contacts", `n=${ccount}`);
    else ng("multi_contacts", `n=${ccount}`);
  } else ng("multi_contacts", "missing prospect");

  // source_attributes
  const withAttrs = (mems ?? []).find(
    (m) =>
      m.source_attributes &&
      typeof m.source_attributes === "object" &&
      "ブース番号" in (m.source_attributes as object),
  );
  if (withAttrs) ok("source_attributes");
  else ng("source_attributes");

  // assignment equal
  const { data: users } = await admin
    .from("app_users")
    .select("id")
    .eq("is_active", true)
    .limit(3);
  const assigneeIds = (users ?? []).map((u) => String(u.id));
  if (assigneeIds.length >= 2) {
    const result = await bulkAssignMemberships({
      membershipIds: (mems ?? []).map((m) => String(m.id)),
      assigneeUserIds: assigneeIds.slice(0, 2),
      mode: "equal",
      onlyUnassigned: true,
      actorId,
      actorName,
    });
    ok("bulk_equal", `updated=${result.updated}`);
  } else {
    ng("bulk_equal", "need 2 users");
  }

  if (mems?.[0]) {
    await setMembershipStage({
      membershipId: String(mems[0].id),
      stage: "working",
      actorId,
      actorName,
    });
    ok("stage_change");
  }

  const { data: dncProspect } = await admin
    .from("prospects")
    .select("id")
    .ilike("company_name", `%Phase13A_DNC_${MARKER}%`)
    .maybeSingle();
  if (dncProspect) {
    await setProspectDoNotContact({
      prospectId: String(dncProspect.id),
      doNotContact: true,
      reason: "e2e",
      actorId,
      actorName,
    });
    ok("dnc");
  } else ng("dnc");

  if (formalDomain) {
    const { data: fm } = await admin
      .from("prospects")
      .select("formal_org_match_page_id,formal_org_match_confidence")
      .ilike("company_name", `%Phase13A_FORMAL_${MARKER}%`)
      .maybeSingle();
    if (fm?.formal_org_match_page_id) ok("formal_match");
    else ng("formal_match", "no match");
  } else {
    ok("formal_match", "skipped_no_domain");
  }

  const { count: orgAfter } = await admin
    .from("customer_index")
    .select("notion_page_id", { count: "exact", head: true });
  if ((orgAfter ?? -1) === (orgBefore ?? -2)) ok("notion_uncontaminated", `n=${orgAfter}`);
  else ng("notion_uncontaminated", `${orgBefore}->${orgAfter}`);

  // archive list + prospects
  await updateProspectList({
    id: list.id,
    patch: { status: "archived" },
    actorId,
    actorName,
  });
  await admin
    .from("prospects")
    .update({ archived_at: new Date().toISOString() })
    .ilike("company_name", `%${MARKER}%`);
  ok("archive");

  // viewer permission sanity
  const { hasPermission } = await import("../src/lib/auth/permissions");
  if (
    hasPermission("viewer", "prospect.view") &&
    !hasPermission("viewer", "prospect.edit")
  ) {
    ok("viewer_readonly");
  } else ng("viewer_readonly");

  console.log(`\nSUMMARY ok=${okN} ng=${ngN} list=${mask(list.id)}`);
  if (ngN > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
