import "server-only";

import { recalculateCustomerLatestActivity } from "@/lib/activities/recalculate-latest-activity";
import { enqueueJob } from "@/lib/jobs/queue";
import type { JobRow } from "@/lib/jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";

const KIND = "customer.recalculate_latest_activity";

function stableKey(customerPageId: string): string {
  return `${KIND}:${customerPageId}`;
}

function uniquePageIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/**
 * 顧客最新対応再計算を enqueue(+任意で即時実行)。
 * 冪等方針は request-recalc.ts(見込み金額) と同型。
 */
export async function requestCustomerLatestActivityRecalc(input: {
  customerPageIds: Array<string | null | undefined>;
  sourceActivityExternalId?: string;
  processInline?: boolean;
  createdBy?: string | null;
}): Promise<{ jobs: JobRow[]; processedInline: string[] }> {
  const admin = createAdminClient();
  const pageIds = uniquePageIds(input.customerPageIds);
  const jobs: JobRow[] = [];
  const processedInline: string[] = [];

  for (const customerPageId of pageIds) {
    const payload = {
      customerPageId,
      sourceActivityExternalId: input.sourceActivityExternalId ?? null,
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
      await recalculateCustomerLatestActivity({
        customerPageId,
        sourceActivityExternalId: input.sourceActivityExternalId,
        jobId: jobs[jobs.length - 1]?.id ?? null,
        admin,
      });
      processedInline.push(customerPageId);
    }
  }

  return { jobs, processedInline };
}
