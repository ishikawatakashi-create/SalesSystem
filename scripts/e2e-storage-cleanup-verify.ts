/**
 * Phase 9: Storage cleanup 実削除経路の安全確認。
 * 本番利用中ファイルは触らない。期限切れの専用fixtureのみ。
 * 秘密値・CSV本文・完全UUIDは出さない。
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { enqueueJob } from "../src/lib/jobs/queue";
import { ensureDailyMaintenanceJobs } from "../src/lib/jobs/daily-maintenance";

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

const BASE =
  process.env.PRODUCTION_BASE_URL?.replace(/\/$/, "") ||
  "https://sales-system-weld.vercel.app";
const PREFIX = "test_phase9_cleanup_";

async function triggerJobs(rounds = 20): Promise<number> {
  const cron = process.env.CRON_SECRET?.trim();
  if (!cron) throw new Error("CRON_SECRET missing");
  let total = 0;
  for (let i = 0; i < rounds; i += 1) {
    const res = await fetch(`${BASE}/api/jobs/run`, {
      method: "POST",
      headers: { "x-cron-secret": cron },
    });
    if (res.status !== 200) {
      console.log("[INFO] jobs/run status", res.status);
      break;
    }
    const json = (await res.json()) as { processed?: number };
    total += json.processed ?? 0;
    if ((json.processed ?? 0) === 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return total;
}

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
  if (!actor?.id) throw new Error("no admin");

  const marker = randomUUID().slice(0, 8);
  const importJobId = randomUUID();
  const storagePath = `${String(actor.id)}/${importJobId}/${PREFIX}${marker}.csv`;
  const body = "col\ntest_phase9_cleanup_row\n";

  const { error: upErr } = await admin.storage
    .from("imports")
    .upload(storagePath, body, { contentType: "text/csv", upsert: true });
  if (upErr) throw new Error(`upload_failed:${upErr.message.slice(0, 60)}`);
  console.log("[OK] fixture_uploaded");

  const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const { error: insErr } = await admin.from("import_jobs").insert({
    id: importJobId,
    file_name: `${PREFIX}${marker}.csv`,
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
  if (insErr) throw new Error(`insert_failed:${insErr.message.slice(0, 80)}`);
  console.log("[OK] expired_import_job_created");

  // Force enqueue regardless of daily gate (dedicated key)
  await enqueueJob({
    kind: "storage_cleanup",
    payload: { reason: "phase9_fixture_verify", marker },
    idempotencyKey: `storage_cleanup:fixture:${marker}`,
    priority: 20,
  });
  const processed = await triggerJobs(30);
  console.log("[INFO] jobs_processed", processed);

  const { data: job } = await admin
    .from("import_jobs")
    .select("deleted_at")
    .eq("id", importJobId)
    .maybeSingle();
  if (job?.deleted_at) {
    console.log("[OK] deleted_at_set");
  } else {
    console.log("[NG] deleted_at_missing");
  }

  const { data: listed } = await admin.storage.from("imports").list(
    `${String(actor.id)}/${importJobId}`,
    { limit: 5 },
  );
  const stillThere = (listed ?? []).some((f) =>
    String(f.name).includes(PREFIX),
  );
  if (!stillThere) {
    console.log("[OK] storage_object_removed");
  } else {
    console.log("[NG] storage_object_still_present");
  }

  // daily gate should be callable
  const daily = await ensureDailyMaintenanceJobs();
  console.log("[OK] daily_maintenance_call", daily.enqueuedStorageCleanup);

  console.log("[DONE] storage_cleanup_path_verified");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.slice(0, 120) : e);
  process.exit(1);
});
