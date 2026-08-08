/**
 * 既存 inquiries を subject だけで安全分類し、
 * 返信等を ingest_classification=ignored_non_source にする。
 * 物理削除しない。PII・本文はログしない。
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
    .select("id,subject,ingest_classification,parser_version")
    .order("received_at", { ascending: false })
    .limit(200);
  if (error) {
    console.log("query_error", error.code);
    process.exit(1);
  }

  let ignored = 0;
  let sourceKept = 0;
  let already = 0;

  for (const row of data ?? []) {
    const subject = (row.subject ?? "").trim();
    const isReply = REPLY_FWD_RE.test(subject);
    const isSourceSubject = SOURCE_SUBJECT_RE.test(subject);

    if (isReply || !isSourceSubject) {
      if (row.ingest_classification === "ignored_non_source") {
        already += 1;
        continue;
      }
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
      ignored += 1;
      continue;
    }

    // 元通知: parser_version を 1 に下げて再pollで再parse可能に（既に2なら維持）
    sourceKept += 1;
    if ((row.parser_version ?? 1) >= 2) continue;
    // 明示的に 1 のまま（default）。再POSTで updated される
  }

  console.log(
    JSON.stringify({
      scanned: data?.length ?? 0,
      marked_ignored_non_source: ignored,
      already_ignored: already,
      source_subject_kept: sourceKept,
    }),
  );
}

main().catch((e) => {
  console.log("failed", e instanceof Error ? e.name : "unknown");
  process.exit(1);
});
