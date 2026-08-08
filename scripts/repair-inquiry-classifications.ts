/**
 * 既存 inquiries の分類修復（PII・本文なし）。
 * - 返信 → ignored_non_source
 * - 元通知件名なのに ignored → source へ復帰
 * - 元通知で no_action かつ未割当・未リンク → new へ復帰（open一覧へ）
 *
 * Usage: npx tsx scripts/repair-inquiry-classifications.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
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

const SOURCE_SUBJECT_RE = /^.+\sはあなたのサイトにコメントしました\s*$/;
const REPLY_FWD_RE = /^(re|fw|fwd)\s*:/i;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.log("missing_env");
    process.exit(1);
  }
  const sb = createClient(url, key);
  const { data, error } = await sb
    .from("inquiries")
    .select(
      "id,subject,status,ingest_classification,assigned_user_id,linked_customer_page_id,linked_contact_page_id,linked_activity_page_id",
    )
    .order("received_at", { ascending: false })
    .limit(200);
  if (error) {
    console.log("query_error", error.code);
    process.exit(1);
  }

  let markedIgnored = 0;
  let restoredSource = 0;
  let reopenedNew = 0;

  for (const row of data ?? []) {
    const subject = (row.subject ?? "").trim();
    const isReply = REPLY_FWD_RE.test(subject);
    const isSourceSubject = SOURCE_SUBJECT_RE.test(subject);

    if (isReply) {
      if (row.ingest_classification !== "ignored_non_source") {
        const { error: upErr } = await sb
          .from("inquiries")
          .update({
            ingest_classification: "ignored_non_source",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (upErr) {
          console.log("update_error", upErr.code);
          process.exit(1);
        }
        markedIgnored += 1;
      }
      continue;
    }

    if (isSourceSubject) {
      if (row.ingest_classification !== "source") {
        const { error: upErr } = await sb
          .from("inquiries")
          .update({
            ingest_classification: "source",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (upErr) {
          console.log("update_error", upErr.code);
          process.exit(1);
        }
        restoredSource += 1;
      }

      // open一覧へ復帰（未割当・未リンクの no_action のみ）
      if (
        row.status === "no_action" &&
        !row.assigned_user_id &&
        !row.linked_customer_page_id &&
        !row.linked_contact_page_id &&
        !row.linked_activity_page_id
      ) {
        const { error: upErr } = await sb
          .from("inquiries")
          .update({
            status: "new",
            no_action_reason: null,
            handled_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (upErr) {
          console.log("update_error", upErr.code);
          process.exit(1);
        }
        reopenedNew += 1;
      }
    }
  }

  console.log(
    JSON.stringify({
      scanned: data?.length ?? 0,
      marked_ignored_non_source: markedIgnored,
      restored_source_classification: restoredSource,
      reopened_no_action_to_new: reopenedNew,
    }),
  );
}

main().catch((e) => {
  console.log("failed", e instanceof Error ? e.name : "unknown");
  process.exit(1);
});
