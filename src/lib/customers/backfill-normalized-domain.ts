import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueJob } from "@/lib/jobs/queue";
import { normalizeDomain } from "@/lib/normalize/domain";

export const BACKFILL_NORMALIZED_DOMAIN_KIND =
  "customer.backfill_normalized_domain" as const;

export type BackfillNormalizedDomainPayload = {
  cursor?: string | null;
  processed?: number;
  updated?: number;
  skipped?: number;
  chainId?: string;
  chunkSize?: number;
};

/**
 * customer_index.normalized_domain を website/email から derived backfill。
 * Notion 非書込。idempotent。
 */
export async function processBackfillNormalizedDomainChunk(input: {
  payload: BackfillNormalizedDomainPayload;
  enqueueNext?: boolean;
  createdBy?: string | null;
  heartbeat?: () => Promise<boolean>;
}): Promise<{
  done: boolean;
  cursor: string | null;
  processed: number;
  updated: number;
  skipped: number;
  chunkSize: number;
}> {
  const admin = createAdminClient();
  const chunkSize = Math.min(
    Math.max(input.payload.chunkSize ?? 200, 1),
    500,
  );
  let processed = input.payload.processed ?? 0;
  let updated = input.payload.updated ?? 0;
  let skipped = input.payload.skipped ?? 0;
  const chainId = input.payload.chainId ?? "normalized-domain-backfill";
  const cursor = input.payload.cursor ?? null;

  let q = admin
    .from("customer_index")
    .select("notion_page_id,website,email,normalized_domain")
    .eq("is_archived", false)
    .order("notion_page_id", { ascending: true })
    .limit(chunkSize);
  if (cursor) {
    q = q.gt("notion_page_id", cursor);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  let lastPageId: string | null = null;

  for (const row of rows) {
    if (input.heartbeat) {
      const alive = await input.heartbeat();
      if (!alive) throw new Error("lease_lost_during_chunk");
    }
    lastPageId = String(row.notion_page_id);
    processed += 1;
    const derived =
      normalizeDomain(row.website as string | null) ??
      normalizeDomain(row.email as string | null);
    const current = (row.normalized_domain as string | null) ?? null;
    if (derived === current) {
      skipped += 1;
      continue;
    }
    const { error: updErr } = await admin
      .from("customer_index")
      .update({
        normalized_domain: derived,
        updated_at: new Date().toISOString(),
      })
      .eq("notion_page_id", row.notion_page_id);
    if (updErr) throw new Error(updErr.message);
    updated += 1;
  }

  const hasMore = rows.length >= chunkSize;
  const nextCursor = hasMore ? lastPageId : null;
  if (hasMore && input.enqueueNext !== false && nextCursor) {
    await enqueueJob({
      kind: BACKFILL_NORMALIZED_DOMAIN_KIND,
      payload: {
        cursor: nextCursor,
        processed,
        updated,
        skipped,
        chainId,
        chunkSize,
      } satisfies BackfillNormalizedDomainPayload,
      idempotencyKey: `${BACKFILL_NORMALIZED_DOMAIN_KIND}:${chainId}:${nextCursor}`,
      createdBy: input.createdBy ?? null,
      priority: 70,
    });
  }

  return {
    done: !hasMore,
    cursor: nextCursor,
    processed,
    updated,
    skipped,
    chunkSize: rows.length,
  };
}
