import "server-only";

import {
  recalculateCustomerNextAction,
  recalculateDealNextAction,
} from "@/lib/actions/recalculate-next-action";
import { enqueueJob } from "@/lib/jobs/queue";
import type { JobRow } from "@/lib/jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";

const CUSTOMER_KIND = "customer.recalculate_next_action";
const DEAL_KIND = "deal.recalculate_next_action";

function uniquePageIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

async function enqueueWithIdempotency(input: {
  kind: string;
  pageIdField: "customerPageId" | "dealPageId";
  pageId: string;
  payload: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<JobRow> {
  const admin = createAdminClient();
  const { data: activeRows, error: activeError } = await admin
    .from("jobs")
    .select("*")
    .eq("kind", input.kind)
    .in("status", ["queued", "running"])
    .filter(`payload->>${input.pageIdField}`, "eq", input.pageId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (activeError) throw new Error(activeError.message);
  const active = activeRows?.[0] ?? null;
  if (active) return active as unknown as JobRow;

  const key = `${input.kind}:${input.pageId}`;
  let job = await enqueueJob({
    kind: input.kind,
    payload: input.payload,
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
      kind: input.kind,
      payload: input.payload,
      idempotencyKey: `${key}:${Date.now()}`,
      createdBy: input.createdBy ?? null,
      priority: 50,
    });
  }
  return job;
}

/**
 * 顧客・案件の次回アクション再計算を enqueue(+任意で即時実行)。
 */
export async function requestNextActionRecalc(input: {
  customerPageIds: Array<string | null | undefined>;
  dealPageIds: Array<string | null | undefined>;
  sourceActionExternalId?: string;
  processInline?: boolean;
  createdBy?: string | null;
}): Promise<{ jobs: JobRow[]; processedInline: string[] }> {
  const admin = createAdminClient();
  const jobs: JobRow[] = [];
  const processedInline: string[] = [];

  for (const customerPageId of uniquePageIds(input.customerPageIds)) {
    const job = await enqueueWithIdempotency({
      kind: CUSTOMER_KIND,
      pageIdField: "customerPageId",
      pageId: customerPageId,
      payload: {
        customerPageId,
        sourceActionExternalId: input.sourceActionExternalId ?? null,
      },
      createdBy: input.createdBy,
    });
    jobs.push(job);

    if (input.processInline) {
      await recalculateCustomerNextAction({
        customerPageId,
        sourceActionExternalId: input.sourceActionExternalId,
        jobId: job.id,
        admin,
      });
      processedInline.push(`customer:${customerPageId}`);
    }
  }

  for (const dealPageId of uniquePageIds(input.dealPageIds)) {
    const job = await enqueueWithIdempotency({
      kind: DEAL_KIND,
      pageIdField: "dealPageId",
      pageId: dealPageId,
      payload: {
        dealPageId,
        sourceActionExternalId: input.sourceActionExternalId ?? null,
      },
      createdBy: input.createdBy,
    });
    jobs.push(job);

    if (input.processInline) {
      await recalculateDealNextAction({
        dealPageId,
        sourceActionExternalId: input.sourceActionExternalId,
        jobId: job.id,
        admin,
      });
      processedInline.push(`deal:${dealPageId}`);
    }
  }

  return { jobs, processedInline };
}
