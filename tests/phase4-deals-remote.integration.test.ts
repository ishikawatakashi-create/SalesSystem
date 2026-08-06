/**
 * Phase 4 案件 relation/index のリモート結合テスト。
 * RUN_REMOTE_DB_TESTS=1 かつ .env.local のSupabase鍵がある場合のみ実行。
 * 読取とprepareDealWrite検証のみ。Notion・既存データへの書込は行わない。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database";
import { prepareDealWrite } from "@/lib/deals/write-schema";
import { isDealSyncError } from "@/lib/sync/errors";

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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();

const RUN = process.env.RUN_REMOTE_DB_TESTS === "1";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

const describeRemote = RUN && url && secret ? describe : describe.skip;

describeRemote("Phase 4 deals リモート結合", () => {
  let admin: SupabaseClient<Database>;

  beforeAll(() => {
    admin = createClient<Database>(url!, secret!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it("deal_index に expected_amount / status_semantic がselectable", async () => {
    const { data, error } = await admin
      .from("deal_index")
      .select("notion_page_id,expected_amount,status_semantic")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("案件ステージ・案件ステータス masters が存在しsemantic_keyを持つ", async () => {
    const { data: stages, error: stageErr } = await admin
      .from("masters_cache")
      .select("notion_page_id,semantic_key")
      .eq("master_type", "案件ステージ")
      .eq("is_active", true);
    expect(stageErr).toBeNull();
    expect((stages?.length ?? 0) > 0).toBe(true);

    const { data: statuses, error: statusErr } = await admin
      .from("masters_cache")
      .select("notion_page_id,semantic_key")
      .eq("master_type", "案件ステータス")
      .eq("is_active", true);
    expect(statusErr).toBeNull();
    const keys = new Set(
      (statuses ?? []).map((s) => s.semantic_key).filter(Boolean),
    );
    expect(keys.has("active")).toBe(true);
    expect(keys.has("on_hold")).toBe(true);
  });

  it("prepareDealWrite が未知のステージを拒否する", async () => {
    const { data: customers } = await admin
      .from("customer_index")
      .select("notion_page_id")
      .eq("is_archived", false)
      .limit(1);
    const customerPageId = customers?.[0]?.notion_page_id;
    expect(customerPageId).toBeTruthy();

    const bogus = randomUUID();
    const requestId = randomUUID();
    let rejected = false;
    try {
      await prepareDealWrite({
        data: {
          title: `test_phase4_deal_it_${bogus.slice(0, 6)}`,
          customerPageId,
          stagePageId: bogus,
        },
        db: admin,
      });
    } catch (e) {
      rejected = isDealSyncError(e) && e.code === "validation";
      if (isDealSyncError(e)) {
        expect(e.detail?.reason).toBe("relation_not_found");
        expect(e.message).not.toContain(bogus);
      }
    }
    expect(rejected).toBe(true);

    const { data: op } = await admin
      .from("write_operations")
      .select("request_id")
      .eq("request_id", requestId)
      .maybeSingle();
    expect(op).toBeNull();
  });

  it("prepareDealWrite がアーカイブ顧客への新規案件を拒否する(該当があれば)", async () => {
    const { data: archived } = await admin
      .from("customer_index")
      .select("notion_page_id")
      .eq("is_archived", true)
      .limit(1);
    if (!archived?.[0]?.notion_page_id) {
      return;
    }

    let reason: string | undefined;
    try {
      await prepareDealWrite({
        data: {
          title: "test_phase4_deal_archived_reject",
          customerPageId: archived[0].notion_page_id,
        },
        db: admin,
      });
    } catch (e) {
      if (isDealSyncError(e)) reason = String(e.detail?.reason);
    }
    expect(reason).toBe("archived_customer_forbidden");
  });
});
