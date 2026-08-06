/**
 * Phase 3 relation検証のリモート結合テスト。
 * RUN_REMOTE_DB_TESTS=1 かつ .env.local のSupabase鍵がある場合のみ実行。
 * 読取とrelation検証のみ。Notion・既存データへの書込は行わない。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database";
import { prepareCustomerWrite } from "@/lib/customers/write-schema";
import { isCustomerSyncError } from "@/lib/sync/errors";

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

const EXPECTED_MASTER_COUNTS: Record<string, number> = {
  事業区分: 2,
  営業ステータス: 13,
  集客ルート: 10,
  優先度: 3,
  対応履歴分類: 8,
  案件ステージ: 7,
  案件ステータス: 5,
  取引区分: 3,
  支払状況: 4,
  契約状態: 4,
  クレーム重要度: 3,
  クレーム対応状況: 3,
  担当者区分: 3,
  アクション状態: 3,
};

describeRemote("Phase 3 masters_cacheとrelation検証(リモート)", () => {
  let admin: SupabaseClient<Database>;

  beforeAll(() => {
    admin = createClient<Database>(url!, secret!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it("masters_cacheが71件・種別別件数が期待どおり", async () => {
    const { data, error } = await admin
      .from("masters_cache")
      .select("master_type,is_active");
    expect(error).toBeNull();
    const rows = data ?? [];
    expect(rows.length).toBe(71);
    const byType = new Map<string, number>();
    for (const r of rows) {
      byType.set(r.master_type, (byType.get(r.master_type) ?? 0) + 1);
    }
    for (const [type, expected] of Object.entries(EXPECTED_MASTER_COUNTS)) {
      expect(byType.get(type), type).toBe(expected);
    }
  });

  it("正しいマスタは通過し、不正マスタ1件はNotion送信前に拒否される", async () => {
    const { data: masters } = await admin
      .from("masters_cache")
      .select("notion_page_id,master_type")
      .eq("master_type", "営業ステータス")
      .eq("is_active", true)
      .limit(1);
    const statusId = masters?.[0]?.notion_page_id;
    expect(statusId).toBeTruthy();

    const base = {
      displayName: `test_phase3_relations_${randomUUID().slice(0, 6)}`,
      salesStatusPageId: statusId,
    };

    // 正しいマスタ: 検証通過(書込はしない)
    const ok = await prepareCustomerWrite({ data: base, db: admin });
    expect(ok.salesStatusPageId).toBe(statusId);

    // 不正マスタ: 検証で拒否 → write_operationsもNotionも到達しない
    const bogus = randomUUID();
    const requestId = randomUUID();
    let rejected = false;
    try {
      await prepareCustomerWrite({
        data: { ...base, salesStatusPageId: bogus },
        db: admin,
      });
    } catch (e) {
      rejected = isCustomerSyncError(e) && e.code === "validation";
      if (isCustomerSyncError(e)) {
        expect(e.detail?.reason).toBe("relation_not_found");
        expect(e.message).not.toContain(bogus);
      }
    }
    expect(rejected).toBe(true);

    // pipelineへ進んでいないため write_operations は作成されていない
    const { data: op } = await admin
      .from("write_operations")
      .select("request_id")
      .eq("request_id", requestId)
      .maybeSingle();
    expect(op).toBeNull();
  });

  it("別種別マスタ(案件ステージ)を営業ステータス欄に指定すると拒否", async () => {
    const { data: stages } = await admin
      .from("masters_cache")
      .select("notion_page_id")
      .eq("master_type", "案件ステージ")
      .limit(1);
    const stageId = stages?.[0]?.notion_page_id;
    expect(stageId).toBeTruthy();

    let reason: string | undefined;
    try {
      await prepareCustomerWrite({
        data: {
          displayName: "test_phase3_relations_wrongtype",
          salesStatusPageId: stageId,
        },
        db: admin,
      });
    } catch (e) {
      if (isCustomerSyncError(e)) reason = String(e.detail?.reason);
    }
    expect(reason).toBe("wrong_master_type");
  });
});
