/**
 * Phase 7 Production Webhook 状態プローブ。
 * シークレット・トークン・payload・個人情報は出力しない。
 *
 * Usage:
 *   PRODUCTION_BASE_URL=https://sales-system-weld.vercel.app npx tsx scripts/e2e-webhook-production-status.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();

  const baseUrl = (
    process.env.PRODUCTION_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://sales-system-weld.vercel.app"
  ).replace(/\/$/, "");
  const webhookUrl = `${baseUrl}/api/webhooks/notion`;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    console.error("setup_status: error (env missing)");
    process.exit(1);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false },
  });

  // setup status
  {
    const { data, error } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", "notion_webhook_setup")
      .maybeSingle();
    if (error) {
      console.log(`setup_status: error`);
    } else {
      const status = (data?.value as { status?: string } | null)?.status;
      console.log(
        `setup_status: ${status === "received" || status === "verified" ? status : "awaiting"}`,
      );
    }
  }

  // vault readable (value never printed)
  {
    const { data, error } = await admin.rpc(
      "read_notion_webhook_verification_token",
    );
    const readable =
      !error && typeof data === "string" && data.trim().length > 0;
    console.log(`vault_readable: ${readable ? "yes" : "no"}`);
  }

  // endpoint GET
  {
    const res = await fetch(webhookUrl, { method: "GET" });
    console.log(`endpoint_GET_status: ${res.status}`);
  }

  // recent webhook_events (2h) + linked failed jobs
  {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: events, error } = await admin
      .from("webhook_events")
      .select("event_id,job_id")
      .gte("received_at", since);
    if (error) {
      console.log(`webhook_events_2h: error`);
      console.log(`webhook_events_linked_failed_jobs: error`);
    } else {
      const rows = events ?? [];
      console.log(`webhook_events_2h: ${rows.length}`);
      const jobIds = rows
        .map((r) => r.job_id as string | null)
        .filter((id): id is string => Boolean(id));
      if (jobIds.length === 0) {
        console.log(`webhook_events_linked_failed_jobs: 0`);
      } else {
        const { count, error: jErr } = await admin
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .in("id", jobIds)
          .eq("status", "failed");
        console.log(
          `webhook_events_linked_failed_jobs: ${jErr ? "error" : (count ?? 0)}`,
        );
      }
    }
  }

  // unresolved sync_errors by stage (counts only)
  {
    const { data, error } = await admin
      .from("sync_errors")
      .select("stage")
      .is("resolved_at", null)
      .is("ignored_at", null);
    if (error) {
      console.log(`unresolved_sync_errors_by_stage: error`);
    } else {
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        const stage = (row.stage as string | null) ?? "(null)";
        counts.set(stage, (counts.get(stage) ?? 0) + 1);
      }
      const parts = [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, v]) => `${k}=${v}`);
      console.log(
        `unresolved_sync_errors_by_stage: ${parts.length ? parts.join(",") : "none"}`,
      );
    }
  }

  // schema_mismatch count
  {
    const { count, error } = await admin
      .from("sync_errors")
      .select("id", { count: "exact", head: true })
      .eq("stage", "schema_mismatch")
      .is("resolved_at", null)
      .is("ignored_at", null);
    console.log(`schema_mismatch_unresolved: ${error ? "error" : (count ?? 0)}`);
  }

  // migration: Phase 7 vault migration already applied previously
  console.log(`migration: not_needed (phase7 vault already applied)`);
}

main().catch(() => {
  console.error("status_probe_failed");
  process.exit(1);
});
