import "server-only";

import type { JobHandler } from "@/lib/jobs/types";
import { createDefaultNotionClient } from "@/lib/notion/client";
import {
  extractDataSourceId,
  resolveEntityByDataSourceId,
} from "@/lib/sync/ds-routing";
import {
  isRetryableNotionError,
  markDeletePending,
  syncPageFromNotion,
} from "@/lib/sync/inbound-page-sync";
import {
  detectSchemaDrift,
  recordSchemaDriftFindings,
} from "@/lib/sync/schema-drift";
import { createAdminClient } from "@/lib/supabase/admin";

type WebhookPayload = {
  id?: string;
  type?: string;
  timestamp?: string;
  entity?: { id?: string; type?: string };
  data?: { parent?: { type?: string; data_source_id?: string } };
};

function pageIdFromEvent(payload: WebhookPayload): string | null {
  if (payload.entity?.type === "page" && payload.entity.id) {
    return payload.entity.id;
  }
  return null;
}

/**
 * webhook_events を処理する後続ジョブ。
 * 常に Notion から再取得し、unknown DS は warning 付きで成功扱い。
 */
export const webhookSyncHandler: JobHandler = async (job) => {
  const eventId = job.payload.event_id;
  if (typeof eventId !== "string" || !eventId) {
    return { status: "failed", errorMessage: "payload.event_id が必要です" };
  }

  const admin = createAdminClient();
  const { data: eventRow, error } = await admin
    .from("webhook_events")
    .select("event_id,event_type,payload")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) {
    return { status: "retry", errorMessage: "webhook_events read failed" };
  }
  if (!eventRow) {
    return { status: "failed", errorMessage: "webhook event not found" };
  }

  const eventType =
    (typeof eventRow.event_type === "string" && eventRow.event_type) ||
    (typeof job.payload.event_type === "string" ? job.payload.event_type : "");
  const payload = (eventRow.payload ?? {}) as WebhookPayload;

  try {
    if (eventType === "data_source.schema_updated") {
      const notion = createDefaultNotionClient();
      const dsId = extractDataSourceId({
        entity: payload.entity,
      });
      const entity = resolveEntityByDataSourceId(dsId);
      const findings = await detectSchemaDrift({
        notion,
        admin,
        entities: entity ? [entity] : undefined,
      });
      const inserted = await recordSchemaDriftFindings({
        findings,
        admin,
        source: "webhook:data_source.schema_updated",
      });
      return {
        status: "succeeded",
        result: {
          eventType,
          findingCount: findings.length,
          inserted,
          entity: entity ?? null,
        },
      };
    }

    if (eventType.startsWith("page.")) {
      const pageId = pageIdFromEvent(payload);
      if (!pageId) {
        return {
          status: "succeeded",
          result: { skipped: true, reason: "missing_page_id" },
        };
      }

      if (eventType === "page.deleted") {
        const result = await markDeletePending({ admin, pageId });
        return { status: "succeeded", result };
      }

      // created / properties_updated / content_updated / moved / undeleted
      const hinted =
        extractDataSourceId({
          pageParent: payload.data?.parent,
          entity:
            payload.entity?.type === "data_source" ? payload.entity : null,
        }) ?? null;

      const result = await syncPageFromNotion({
        pageId,
        admin,
        hintedDataSourceId: hinted,
        eventType,
      });
      return { status: "succeeded", result };
    }

    // 未対応イベントは成功扱い(リトライしない)
    return {
      status: "succeeded",
      result: { skipped: true, reason: "unsupported_event_type", eventType },
    };
  } catch (error) {
    if (isRetryableNotionError(error)) {
      const message =
        error instanceof Error ? error.message : "notion_transient";
      return { status: "retry", errorMessage: message, backoffSeconds: 60 };
    }
    const message = error instanceof Error ? error.message : "webhook_sync_failed";
    // 変換失敗等は無限リトライしない。警告を残して成功。
    await admin.from("sync_errors").insert({
      stage: "webhook_sync",
      entity_type: null,
      notion_page_id: pageIdFromEvent(payload),
      external_id: null,
      message,
      detail: { event_id: eventId, event_type: eventType },
    } as never);
    return {
      status: "succeeded",
      result: { warning: true, message },
    };
  }
};
