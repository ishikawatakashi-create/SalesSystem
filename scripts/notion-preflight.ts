/**
 * Notion read-only preflight。
 * Notionへ変更を加えない。トークンと親ページIDはログに出さない。
 *
 * Usage: npx tsx scripts/notion-preflight.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Client } from "@notionhq/client";

import { NOTION_API_VERSION } from "../src/lib/notion/version";
import { SETUP_STATE_KEY } from "../src/lib/notion/setup/apply";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

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
    // 空値は後続の同名キーを潰さない。非空のみ採用(後勝ち)。
    if (!value) continue;
    process.env[key] = value;
  }
}

function maskId(value: string | undefined): string {
  if (!value) return "[missing]";
  if (value.length <= 8) return "[set:len=" + value.length + "]";
  return `[set:len=${value.length},prefix=${value.slice(0, 4)}…]`;
}

async function main() {
  loadEnvLocal();
  const checks: CheckResult[] = [];
  const token = process.env.NOTION_TOKEN;
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;

  console.log("# Notion read-only preflight");
  console.log(`api_version: ${NOTION_API_VERSION}`);
  console.log(`NOTION_TOKEN: ${token ? "[set]" : "[missing]"}`);
  console.log(`NOTION_PARENT_PAGE_ID: ${maskId(parentPageId)}`);
  console.log("");

  if (!token) {
    failAndExit(checks, "auth", "NOTION_TOKEN が未設定です");
  }
  if (!parentPageId) {
    failAndExit(checks, "parent_page", "NOTION_PARENT_PAGE_ID が未設定です");
  }
  if (!supabaseUrl || !supabaseSecret) {
    failAndExit(
      checks,
      "supabase",
      "Supabase URL/Secret が未設定です(system_settings確認に必要)",
    );
  }

  const notion = new Client({
    auth: token,
    notionVersion: NOTION_API_VERSION,
  });

  // 1) Auth
  try {
    const me = await notion.users.me({});
    const botName =
      me.type === "bot"
        ? ((me as { name?: string | null }).name ?? "bot")
        : me.type;
    checks.push({
      name: "auth",
      ok: true,
      detail: `users.me 成功 (type=${me.type}, name=${botName})`,
    });
  } catch (error) {
    const status = notionErrorStatus(error);
    checks.push({
      name: "auth",
      ok: false,
      detail: `users.me 失敗 (status=${status ?? "unknown"})`,
    });
    printAndExit(checks, 1);
  }

  // 2) Parent page retrieve + 3) in_trash
  type ParentPageInfo = {
    object?: string;
    in_trash?: boolean;
    archived?: boolean;
    parent?: { type?: string };
  };
  let parentObject: ParentPageInfo | null = null;
  try {
    parentObject = (await notion.pages.retrieve({
      page_id: parentPageId!,
    })) as unknown as ParentPageInfo;
    checks.push({
      name: "parent_page_readable",
      ok: true,
      detail: `親ページ取得成功 (object=${parentObject?.object ?? "page"})`,
    });
  } catch (error) {
    const status = notionErrorStatus(error);
    checks.push({
      name: "parent_page_readable",
      ok: false,
      detail: `親ページ取得失敗 (status=${status ?? "unknown"}). Integration未接続または権限不足の可能性`,
    });
    printAndExit(checks, 1);
  }

  const inTrash = Boolean(parentObject?.in_trash);
  checks.push({
    name: "parent_not_in_trash",
    ok: !inTrash,
    detail: inTrash
      ? "親ページは in_trash=true です"
      : "親ページは in_trash ではない",
  });
  if (parentObject?.archived) {
    checks.push({
      name: "parent_archived_field",
      ok: false,
      detail: "応答に archived が含まれます。API 2026-03-11 では in_trash を使用すること",
    });
  }

  // 4) Capabilities — 読み取りは実測、挿入・更新は「権限不足(403)」と
  // 「入力不正(400)」を区別するプローブで非破壊検証する。
  // 400ならリクエストは権限チェックを通過している。403なら権限不足。
  try {
    await notion.blocks.children.list({
      block_id: parentPageId!,
      page_size: 1,
    });
    checks.push({
      name: "capability_read",
      ok: true,
      detail: "pages.retrieve + blocks.children.list 成功 (読み取り権限あり)",
    });
  } catch (error) {
    const status = notionErrorStatus(error);
    checks.push({
      name: "capability_read",
      ok: false,
      detail: `子ブロック一覧取得失敗 (status=${status ?? "unknown"})`,
    });
  }

  // insert probe: 不正な parent ID で validation 400 を誘発(ページ未作成)
  try {
    await notion.pages.create({
      parent: { page_id: "00000000-0000-0000-0000-000000000000" },
      properties: {
        title: {
          title: [{ text: { content: "preflight-should-not-create" } }],
        },
      },
    } as never);
    checks.push({
      name: "capability_insert",
      ok: false,
      detail:
        "pages.create が成功してしまった(予期しない書き込み)。手動確認が必要です",
    });
  } catch (error) {
    const status = notionErrorStatus(error);
    // 400 validation / 404 not found は作成なし。403 は権限不足。
    if (status === 400 || status === 404) {
      checks.push({
        name: "capability_insert",
        ok: true,
        detail: `pages.create が status=${status} で拒否(作成なし)。挿入権限チェック通過(親への接続は read で確認済み)`,
      });
    } else if (status === 403) {
      checks.push({
        name: "capability_insert",
        ok: false,
        detail: "pages.create が 403。Insert content 権限が不足しています",
      });
    } else {
      checks.push({
        name: "capability_insert",
        ok: false,
        detail: `pages.create プローブ失敗 (status=${status ?? "unknown"})`,
      });
    }
  }

  // update probe: 存在しないプロパティ更新 → 400 を期待(ページ内容は変更しない想定)
  try {
    await notion.pages.update({
      page_id: parentPageId!,
      properties: {
        "__preflight_nonexistent_property__": {
          rich_text: [{ text: { content: "preflight" } }],
        },
      },
    } as never);
    checks.push({
      name: "capability_update",
      ok: false,
      detail:
        "pages.update が成功してしまった(予期しない変更)。手動確認が必要です",
    });
  } catch (error) {
    const status = notionErrorStatus(error);
    if (status === 400) {
      checks.push({
        name: "capability_update",
        ok: true,
        detail:
          "pages.update が validation(400) で拒否(更新なし)。更新権限チェック通過",
      });
    } else if (status === 403) {
      checks.push({
        name: "capability_update",
        ok: false,
        detail: "pages.update が 403。Update content 権限が不足しています",
      });
    } else {
      checks.push({
        name: "capability_update",
        ok: false,
        detail: `pages.update プローブ失敗 (status=${status ?? "unknown"})`,
      });
    }
  }

  // 5) system_settings に既存 setup state がない
  const supabase = createClient(supabaseUrl!, supabaseSecret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: setupRow, error: setupError } = await supabase
    .from("system_settings")
    .select("key,updated_at")
    .eq("key", SETUP_STATE_KEY)
    .maybeSingle();

  if (setupError) {
    checks.push({
      name: "no_existing_setup_state",
      ok: false,
      detail: `system_settings参照失敗: ${setupError.message}`,
    });
  } else if (setupRow) {
    checks.push({
      name: "no_existing_setup_state",
      ok: false,
      detail: `既存の ${SETUP_STATE_KEY} があります (updated_at=${setupRow.updated_at ?? "unknown"})`,
    });
  } else {
    checks.push({
      name: "no_existing_setup_state",
      ok: true,
      detail: `${SETUP_STATE_KEY} は存在しない (初回setup可能)`,
    });
  }

  const allOk = checks.every((c) => c.ok);
  printAndExit(checks, allOk ? 0 : 1);
}

function notionErrorStatus(error: unknown): number | null {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return null;
}

function failAndExit(
  checks: CheckResult[],
  name: string,
  detail: string,
): never {
  checks.push({ name, ok: false, detail });
  printAndExit(checks, 1);
}

function printAndExit(checks: CheckResult[], code: number): never {
  console.log("## Results");
  for (const c of checks) {
    console.log(`- [${c.ok ? "OK" : "NG"}] ${c.name}: ${c.detail}`);
  }
  console.log("");
  console.log(
    code === 0
      ? "Preflight SUCCESS (read-only, no Notion mutations)."
      : "Preflight FAILED.",
  );
  console.log("setup-notion.ts --apply was NOT executed.");
  process.exit(code);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown error";
  // トークン・ページIDを含む可能性のあるメッセージは出さない
  console.error(`preflight crashed: ${message.replace(/ntn_[A-Za-z0-9]+/g, "[redacted]").replace(/secret_[A-Za-z0-9]+/g, "[redacted]")}`);
  process.exit(1);
});
