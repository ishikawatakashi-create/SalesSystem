import "server-only";

import { recalculateCustomerExpectedAmount } from "@/lib/deals/recalculate-expected-amount";
import { enqueueJob } from "@/lib/jobs/queue";
import type { JobRow } from "@/lib/jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";

const KIND = "customer.recalculate_expected_amount";

function stableKey(customerPageId: string): string {
  return `${KIND}:${customerPageId}`;
}

function uniqueCustomerPageIds(
  ids: Array<string | null | undefined>,
): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/**
 * 顧客見込み金額再計算を enqueue(+任意で即時実行)。
 *
 * 冪等方針:
 * 1. 同一顧客で queued/running があれば新規enqueueせず合流
 * 2. 安定キー `customer.recalculate_expected_amount:${pageId}` で試行
 * 3. グローバルUNIQUEで succeeded/failed 等が返った場合は
 *    `${stable}:${Date.now()}` で新規ジョブを追加
 * 4. processInline=true なら enqueue 後に対象顧客を1回ずつ即時再計算
 */
export async function requestCustomerExpectedAmountRecalc(input: {
  customerPageIds: Array<string | null | undefined>;
  sourceDealExternalId?: string;
  processInline?: boolean;
  createdBy?: string | null;
}): Promise<{ jobs: JobRow[]; processedInline: string[] }> {
  const admin = createAdminClient();
  const pageIds = uniqueCustomerPageIds(input.customerPageIds);
  const jobs: JobRow[] = [];
  const processedInline: string[] = [];

  for (const customerPageId of pageIds) {
    const payload = {
      customerPageId,
      sourceDealExternalId: input.sourceDealExternalId ?? null,
    };

    const { data: activeRows, error: activeError } = await admin
      .from("jobs")
      .select("*")
      .eq("kind", KIND)
      .in("status", ["queued", "running"])
      .filter("payload->>customerPageId", "eq", customerPageId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (activeError) throw new Error(activeError.message);
    const active = activeRows?.[0] ?? null;

    if (active) {
      jobs.push(active as unknown as JobRow);
    } else {
      const key = stableKey(customerPageId);
      let job = await enqueueJob({
        kind: KIND,
        payload,
        idempotencyKey: key,
        createdBy: input.createdBy ?? null,
        priority: 50,
      });

      if (
        job.status === "succeeded" ||
        job.status === "failed" ||
        job.status === "cancelled" ||
        job.status === "paused"
      ) {
        job = await enqueueJob({
          kind: KIND,
          payload,
          idempotencyKey: `${key}:${Date.now()}`,
          createdBy: input.createdBy ?? null,
          priority: 50,
        });
      }
      jobs.push(job);
    }

    if (input.processInline) {
      await recalculateCustomerExpectedAmount({
        customerPageId,
        sourceDealExternalId: input.sourceDealExternalId,
        jobId: jobs[jobs.length - 1]?.id ?? null,
        admin,
      });
      processedInline.push(customerPageId);
    }
  }

  return { jobs, processedInline };
}
