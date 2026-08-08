/**
 * 関係性デフォルト付与ジョブを enqueue。
 * --dry-run は empty relationship_ids の件数のみ集計（enqueue しない）。
 *
 * Usage:
 *   npx tsx scripts/enqueue-relationship-backfill.ts --dry-run
 *   npx tsx scripts/enqueue-relationship-backfill.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

/** jobs.kind（src/lib/jobs/types.ts と一致。server-only モジュールは import しない） */
const KIND = "customer.backfill_default_relationship";

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
    process.env[key] = value;
  }
}

function parseArgs(argv: string[]) {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
  }
  return { dryRun };
}

async function main() {
  loadEnvLocal();
  const { dryRun } = parseArgs(process.argv.slice(2));

  if (!process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_URL が必要です");
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { count, error: countError } = await supabase
    .from("customer_index")
    .select("notion_page_id", { count: "exact", head: true })
    .filter("relationship_ids", "eq", "{}");
  if (countError) throw new Error(countError.message);

  const emptyCount = count ?? 0;
  console.log(`empty_relationship_ids=${emptyCount}`);

  if (dryRun) {
    console.log("dry-run: enqueue skipped");
    return;
  }

  if (emptyCount === 0) {
    console.log("nothing to enqueue");
    return;
  }

  const chainId = crypto.randomUUID();
  const idempotencyKey = `${KIND}:${chainId}:start`;

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      kind: KIND,
      payload: {
        cursor: null,
        processed: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        chainId,
      },
      priority: 60,
      idempotency_key: idempotencyKey,
      next_run_at: new Date().toISOString(),
    })
    .select("id,kind,status")
    .single();

  if (error) {
    throw new Error(`enqueue failed: ${error.message}`);
  }

  console.log(
    `enqueued kind=${data.kind} status=${data.status} job_id_prefix=${String(data.id).slice(0, 8)}… candidates=${emptyCount}`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`enqueue-relationship-backfill failed: ${message}`);
  process.exit(1);
});
