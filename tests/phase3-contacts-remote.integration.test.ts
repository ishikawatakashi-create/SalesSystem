/**
 * Phase 3 先方担当者 relation/index のリモート結合テスト。
 * RUN_REMOTE_DB_TESTS=1 かつ .env.local のSupabase鍵がある場合のみ実行。
 * 読取とprepareContactWrite検証のみ。Notion・既存データへの書込は行わない。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database";
import { prepareContactWrite } from "@/lib/contacts/write-schema";
import { isContactSyncError } from "@/lib/sync/errors";

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

describeRemote("Phase 3 contacts リモート結合", () => {
  let admin: SupabaseClient<Database>;

  beforeAll(() => {
    admin = createClient<Database>(url!, secret!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it("contact_index に phone 列がselectable", async () => {
    const { data, error } = await admin
      .from("contact_index")
      .select("notion_page_id,phone,phone_normalized")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("担当者区分 masters が3件", async () => {
    const { data, error } = await admin
      .from("masters_cache")
      .select("notion_page_id")
      .eq("master_type", "担当者区分");
    expect(error).toBeNull();
    expect(data?.length).toBe(3);
  });

  it("prepareContactWrite が未知の担当者区分を拒否する", async () => {
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
      await prepareContactWrite({
        data: {
          name: `test_phase3_contact_it_${bogus.slice(0, 6)}`,
          customerPageId,
          contactTypePageId: bogus,
        },
        db: admin,
      });
    } catch (e) {
      rejected = isContactSyncError(e) && e.code === "validation";
      if (isContactSyncError(e)) {
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

  it("prepareContactWrite がアーカイブ顧客への新規所属を拒否する(該当があれば)", async () => {
    const { data: archived } = await admin
      .from("customer_index")
      .select("notion_page_id")
      .eq("is_archived", true)
      .limit(1);
    if (!archived?.[0]?.notion_page_id) {
      // テスト用アーカイブ顧客が無い場合はスキップ
      return;
    }

    const { data: types } = await admin
      .from("masters_cache")
      .select("notion_page_id")
      .eq("master_type", "担当者区分")
      .eq("is_active", true)
      .limit(1);
    const typeId = types?.[0]?.notion_page_id;

    let reason: string | undefined;
    try {
      await prepareContactWrite({
        data: {
          name: "test_phase3_contact_archived_reject",
          customerPageId: archived[0].notion_page_id,
          contactTypePageId: typeId ?? null,
        },
        db: admin,
      });
    } catch (e) {
      if (isContactSyncError(e)) reason = String(e.detail?.reason);
    }
    expect(reason).toBe("archived_customer_forbidden");
  });
});
