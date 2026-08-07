/**
 * Phase 7 Notion Webhook の Production 相当シミュレーション。
 * LOCAL(既定: NEXT_PUBLIC_APP_URL) または PRODUCTION_BASE_URL に対して検証する。
 *
 * Usage:
 *   npx tsx scripts/e2e-webhook-simulated.ts
 *   PRODUCTION_BASE_URL=https://sales-system-weld.vercel.app npx tsx scripts/e2e-webhook-simulated.ts
 *
 * トークン・署名・シークレットはログに出さない。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { signWebhookPayload } from "@notionhq/client";

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

function ok(step: string, detail?: string) {
  console.log(`- [OK] ${step}${detail ? `: ${detail}` : ""}`);
}
function ng(step: string, detail?: string): never {
  console.error(`- [NG] ${step}${detail ? `: ${detail}` : ""}`);
  throw new Error(`E2E failed at ${step}`);
}

async function main() {
  loadEnvLocal();

  const baseUrl = (
    process.env.PRODUCTION_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const webhookUrl = `${baseUrl}/api/webhooks/notion`;
  const jobsUrl = `${baseUrl}/api/jobs/run`;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    ng("env", "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required");
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false },
  });

  const isProductionTarget = Boolean(process.env.PRODUCTION_BASE_URL?.trim());
  const verificationToken = process.env.NOTION_WEBHOOK_SECRET?.trim();
  // 実Notion subscription 前の模擬E2Eでは一時トークンを Vault へ保存してよい。
  // 実 verification 受信時に上書きされる。ログへは出さない。
  const tokenForTest =
    verificationToken ||
    `test_phase7_sim_${Date.now().toString(36)}_do_not_log`;
  if (isProductionTarget && !verificationToken) {
    console.log(
      "- [INFO] PRODUCTION 模擬E2E: 一時トークンを Vault へ保存します(実subscription時に上書き)",
    );
  }

  console.log(`Phase 7 webhook simulated e2e → ${baseUrl}`);

  // 1. GET → 405
  {
    const res = await fetch(webhookUrl, { method: "GET" });
    if (res.status !== 405) ng("GET 405", `status=${res.status}`);
    ok("GET → 405");
  }

  // 2. verification handshake → 200 + status received
  {
    const body = JSON.stringify({
      verification_token: tokenForTest,
    });
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (res.status !== 200) ng("handshake 200", `status=${res.status}`);
    const json = (await res.json()) as { ok?: boolean };
    if (!json.ok) ng("handshake body");
    // レスポンスに verification_token キーを含めない
    if ("verification_token" in json) {
      ng("handshake no token in response");
    }

    const { data, error } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", "notion_webhook_setup")
      .maybeSingle();
    if (error) ng("setup status read", error.message);
    const status = (data?.value as { status?: string } | null)?.status;
    if (status !== "received" && status !== "verified") {
      ng("setup status received", `status=${status ?? "null"}`);
    }
    // value にトークン平文が無いこと
    const valueStr = JSON.stringify(data?.value ?? {});
    if (valueStr.includes(tokenForTest)) {
      ng("setup value must not contain token");
    }
    ok("POST verification_token → 200", `status=${status}`);
  }

  // 3. unsigned event → 401
  {
    const eventId = `test_phase7_webhook_unsigned_${Date.now()}`;
    const body = JSON.stringify({
      id: eventId,
      type: "page.created",
      entity: { id: "00000000-0000-0000-0000-000000000001", type: "page" },
      timestamp: new Date().toISOString(),
    });
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (res.status !== 401) ng("unsigned 401", `status=${res.status}`);
    ok("POST unsigned event → 401");
  }

  // 4. signed event → 200 + webhook_events + job
  const signedEventId = `test_phase7_webhook_signed_${Date.now()}`;
  {
    // env が無い場合は vault に保存済みトークンで署名する必要がある。
    // handshake で同じ verificationToken を vault へ入れたので、
    // NOTION_WEBHOOK_SECRET 未設定でも署名は verificationToken で行う。
    const body = JSON.stringify({
      id: signedEventId,
      type: "page.properties_updated",
      entity: { id: "00000000-0000-0000-0000-000000000002", type: "page" },
      timestamp: new Date().toISOString(),
    });
    const signature = await signWebhookPayload({
      body,
      verificationToken: tokenForTest,
    });
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-notion-signature": signature,
      },
      body,
    });
    if (res.status !== 200) {
      ng("signed 200", `status=${res.status}`);
    }
    const json = (await res.json()) as { ok?: boolean };
    if (!json.ok) ng("signed body");

    const { data: ev, error: evErr } = await admin
      .from("webhook_events")
      .select("event_id,event_type,job_id")
      .eq("event_id", signedEventId)
      .maybeSingle();
    if (evErr) ng("webhook_events read", evErr.message);
    if (!ev) ng("webhook_events row missing");
    if (!ev.job_id) ng("job_id missing on webhook_events");

    const { data: job, error: jobErr } = await admin
      .from("jobs")
      .select("id,kind,status")
      .eq("id", ev.job_id)
      .maybeSingle();
    if (jobErr) ng("jobs read", jobErr.message);
    if (!job || job.kind !== "webhook_sync") ng("webhook_sync job");
    ok("POST signed event → 200", `job=${String(job.id).slice(0, 8)}…`);
  }

  // 5. optional: trigger jobs/run
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const res = await fetch(jobsUrl, {
      method: "POST",
      headers: { "x-cron-secret": cronSecret },
    });
    if (res.status !== 200) {
      console.log(`- [WARN] jobs/run status=${res.status} (skipped assert)`);
    } else {
      const json = (await res.json()) as { ok?: boolean; processed?: number };
      ok("jobs/run triggered", `processed=${json.processed ?? "?"}`);
    }
  } else {
    console.log("- [SKIP] jobs/run (CRON_SECRET missing)");
  }

  console.log("Phase 7 webhook simulated e2e: ALL PASSED");
}

main().catch((e) => {
  console.error("E2E_FAILED", e instanceof Error ? e.message : "unknown");
  process.exit(1);
});
