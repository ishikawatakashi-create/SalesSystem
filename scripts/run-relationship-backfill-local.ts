/**
 * Local chunk runner for customer.backfill_default_relationship.
 * Uses write pipeline → Notion（Supabase-only 更新はしない）.
 *
 * Usage:
 *   $env:NODE_OPTIONS='--require ./scripts/shims/mock-server-only.cjs'
 *   npx tsx scripts/run-relationship-backfill-local.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { processBackfillDefaultRelationshipChunk } from "../src/lib/customers/backfill-default-relationship";
import { createAdminClient } from "../src/lib/supabase/admin";

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
    if (value && !process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();
  const admin = createAdminClient();
  const chainId = crypto.randomUUID();
  let cursor: string | null = null;
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let round = 0;

  for (;;) {
    round += 1;
    const result = await processBackfillDefaultRelationshipChunk({
      payload: { cursor, processed, updated, skipped, failed, chainId },
      admin,
      chunkSize: 5,
      enqueueNext: false,
    });
    processed = result.processed;
    updated = result.updated;
    skipped = result.skipped;
    failed = result.failed;
    cursor = result.cursor;
    console.log(
      JSON.stringify({
        round,
        chunkSize: result.chunkSize,
        done: result.done,
        processed,
        updated,
        skipped,
        failed,
        cursor: cursor ? `${cursor.slice(0, 8)}…` : null,
      }),
    );
    if (result.done) break;
  }

  const { count: empty } = await admin
    .from("customer_index")
    .select("notion_page_id", { count: "exact", head: true })
    .filter("relationship_ids", "eq", "{}");
  const { count: withCustomer } = await admin
    .from("customer_index")
    .select("notion_page_id", { count: "exact", head: true })
    .contains("relationship_semantic_keys", ["customer"]);
  const { count: total } = await admin
    .from("customer_index")
    .select("notion_page_id", { count: "exact", head: true });

  console.log(
    JSON.stringify({
      final_empty: empty ?? 0,
      with_customer_key: withCustomer ?? 0,
      total: total ?? 0,
      processed,
      updated,
      skipped,
      failed,
    }),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
