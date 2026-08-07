/**
 * Phase 9 storage cleanup: invoke handler locally against remote DB.
 * Only deletes a dedicated expired fixture. No secrets/PII in logs.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { storageCleanupHandler } from "../src/lib/jobs/handlers/storage-cleanup";
import type { JobRow } from "../src/lib/jobs/types";

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
  const { data: actor } = await admin
    .from("app_users")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!actor?.id) throw new Error("no_admin");

  const marker = randomUUID().slice(0, 8);
  const importJobId = randomUUID();
  const storagePath = `${String(actor.id)}/${importJobId}/test_phase9_cleanup_${marker}.csv`;
  const body = "col\ntest_phase9_cleanup_only\n";

  const { error: upErr } = await admin.storage
    .from("imports")
    .upload(storagePath, body, { contentType: "text/csv", upsert: true });
  if (upErr) throw new Error(upErr.message.slice(0, 80));
  console.log("[OK] uploaded_fixture");

  const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const { error: insErr } = await admin.from("import_jobs").insert({
    id: importJobId,
    file_name: `test_phase9_cleanup_${marker}.csv`,
    storage_path: storagePath,
    file_size: Buffer.byteLength(body),
    expires_at: past,
    deleted_at: null,
    status: "completed",
    created_by: actor.id,
    entity_type: "customers",
    source_system: "phase9_cleanup_fixture",
    row_count: 1,
  });
  if (insErr) throw new Error(insErr.message.slice(0, 80));
  console.log("[OK] expired_row_inserted");

  const fakeJob = {
    id: randomUUID(),
    kind: "storage_cleanup",
    payload: { reason: "fixture" },
  } as unknown as JobRow;

  const result = await storageCleanupHandler(fakeJob, {
    heartbeat: async () => true,
  });
  console.log("[INFO] handler_status", result.status);
  console.log(
    "[INFO] cleaned",
    (result as { result?: { cleaned?: number } }).result?.cleaned ?? "n/a",
  );

  const { data: job } = await admin
    .from("import_jobs")
    .select("deleted_at")
    .eq("id", importJobId)
    .maybeSingle();
  console.log(job?.deleted_at ? "[OK] deleted_at_set" : "[NG] deleted_at_missing");

  const { data: listed } = await admin.storage
    .from("imports")
    .list(`${String(actor.id)}/${importJobId}`, { limit: 5 });
  const still = (listed ?? []).some((f) =>
    String(f.name).includes("test_phase9_cleanup_"),
  );
  console.log(still ? "[NG] object_still_present" : "[OK] object_removed");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.slice(0, 120) : e);
  process.exit(1);
});
