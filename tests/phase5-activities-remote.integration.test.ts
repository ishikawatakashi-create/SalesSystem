/**
 * Phase 5 対応履歴/アクション relation・index のリモート結合テスト。
 * RUN_REMOTE_DB_TESTS=1 かつ .env.local のSupabase鍵がある場合のみ実行。
 * 読取とprepare*Write検証のみ。Notion書込は行わない。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database";
import { prepareActivityWrite } from "@/lib/activities/write-schema";
import { prepareActionWrite } from "@/lib/actions/write-schema";
import { isActivitySyncError, isActionSyncError } from "@/lib/sync/errors";

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

describeRemote("Phase 5 activities/actions リモート結合", () => {
  let admin: SupabaseClient<Database>;

  beforeAll(() => {
    admin = createClient<Database>(url!, secret!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it("activity_index / action_index の主要列がselectable", async () => {
    const a = await admin
      .from("activity_index")
      .select(
        "notion_page_id,external_id,customer_page_id,deal_page_id,contact_page_ids,category_ids,activity_at,summary,search_text,body_hash",
      )
      .limit(1);
    expect(a.error).toBeNull();

    const b = await admin
      .from("action_index")
      .select(
        "notion_page_id,external_id,customer_page_id,deal_page_id,staff_page_id,status_id,is_open,due_date,search_text",
      )
      .limit(1);
    expect(b.error).toBeNull();
  });

  it("対応履歴分類・アクション状態 masters と semantic_key", async () => {
    const { data: cats, error: catErr } = await admin
      .from("masters_cache")
      .select("notion_page_id")
      .eq("master_type", "対応履歴分類")
      .eq("is_active", true);
    expect(catErr).toBeNull();
    expect((cats?.length ?? 0) > 0).toBe(true);

    const { data: statuses, error: stErr } = await admin
      .from("masters_cache")
      .select("notion_page_id,semantic_key")
      .eq("master_type", "アクション状態")
      .eq("is_active", true);
    expect(stErr).toBeNull();
    const keys = new Set(
      (statuses ?? []).map((s) => s.semantic_key).filter(Boolean),
    );
    expect(keys.has("open")).toBe(true);
    expect(keys.has("done")).toBe(true);
    expect(keys.has("cancelled")).toBe(true);
  });

  it("prepareActivityWrite が未知の分類を拒否する", async () => {
    const { data: customers } = await admin
      .from("customer_index")
      .select("notion_page_id")
      .eq("is_archived", false)
      .limit(1);
    const customerPageId = customers?.[0]?.notion_page_id;
    expect(customerPageId).toBeTruthy();

    const bogus = randomUUID();
    try {
      await prepareActivityWrite({
        data: {
          title: `test_phase5_activity_it_${bogus.slice(0, 6)}`,
          customerPageId,
          activityAt: new Date().toISOString(),
          body: "it",
          categoryPageIds: [bogus],
        },
        db: admin,
      });
      expect.fail("should reject");
    } catch (e) {
      expect(isActivitySyncError(e)).toBe(true);
    }

    const { count } = await admin
      .from("write_operations")
      .select("request_id", { count: "exact", head: true })
      .eq("entity_type", "activity")
      .ilike("external_id", `%${bogus.slice(0, 8)}%`);
    expect(count ?? 0).toBe(0);
  });

  it("prepareActionWrite が未知の状態を拒否する", async () => {
    const { data: customers } = await admin
      .from("customer_index")
      .select("notion_page_id")
      .eq("is_archived", false)
      .limit(1);
    const customerPageId = customers?.[0]?.notion_page_id;
    expect(customerPageId).toBeTruthy();

    const bogus = randomUUID();
    try {
      await prepareActionWrite({
        data: {
          title: `test_phase5_action_it_${bogus.slice(0, 6)}`,
          customerPageId,
          dueDate: "2026-08-10",
          statusPageId: bogus,
        },
        db: admin,
      });
      expect.fail("should reject");
    } catch (e) {
      expect(isActionSyncError(e)).toBe(true);
    }
  });
});
