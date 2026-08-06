import { NextResponse } from "next/server";

import { runJobWorker, verifyCronSecret } from "@/lib/jobs/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ジョブワーカー入口。
 * SupabaseCronScheduler(pg_cron + pg_net) または代替スケジューラから毎分呼ばれる。
 * CRON_SECRET未一致は401。Secret keyはクライアントへ公開しない。
 */
export async function POST(request: Request) {
  const secret =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization");

  if (!verifyCronSecret(secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runJobWorker();
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ジョブワーカー実行に失敗しました";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  // 一部CronはGETのみ対応するため同一検証で許可
  return POST(request);
}
