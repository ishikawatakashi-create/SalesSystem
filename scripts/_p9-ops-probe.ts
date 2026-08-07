/**
 * Phase 9 ops probe — counts/statuses only. No secrets/PII/UUIDs.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: wh } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "notion_webhook_setup")
    .maybeSingle();
  const whVal = wh?.value as { status?: string } | null;
  console.log("webhook_status", whVal?.status ?? "missing");

  const { count: se } = await admin
    .from("sync_errors")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null)
    .is("ignored_at", null);
  console.log("unresolved_sync_errors", se ?? 0);

  const { count: drift } = await admin
    .from("sync_errors")
    .select("id", { count: "exact", head: true })
    .eq("stage", "schema_mismatch")
    .is("resolved_at", null)
    .is("ignored_at", null);
  console.log("schema_drift", drift ?? 0);

  for (const s of ["queued", "running", "failed", "succeeded"]) {
    const { count } = await admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", s);
    console.log(`jobs_${s}`, count ?? 0);
  }

  for (const s of [
    "importing",
    "ready",
    "failed",
    "uploaded",
    "mapping_required",
    "validating",
    "partially_completed",
  ]) {
    const { count } = await admin
      .from("import_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", s);
    if ((count ?? 0) > 0) console.log(`import_${s}`, count);
  }

  const { data: bucket } = await admin.storage.getBucket("imports");
  console.log("imports_public", Boolean(bucket?.public));

  const { data: worker } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "job_worker")
    .maybeSingle();
  console.log(
    "job_worker_scheduler",
    (worker?.value as { scheduler?: string } | null)?.scheduler ?? "unset",
  );

  // test prefix inventory (counts only)
  for (const [table, col] of [
    ["customer_index", "display_name"],
    ["contact_index", "name"],
    ["deal_index", "name"],
    ["activity_index", "title"],
    ["action_index", "title"],
    ["contract_index", "name"],
    ["complaint_index", "title"],
  ] as const) {
    const { count } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .ilike(col, "test%");
    console.log(`test_${table}`, count ?? 0);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.slice(0, 120) : e);
  process.exit(1);
});
