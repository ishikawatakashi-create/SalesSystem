import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export async function writeProspectAudit(input: {
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType:
    | "prospect"
    | "prospect_list"
    | "prospect_contact"
    | "prospect_membership"
    | "prospect_import";
  entityId: string;
  changedFields?: Record<string, unknown> | null;
  operationSource?: string | null;
  requestId?: string | null;
  batchId?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_logs").insert({
    actor_id: input.actorId,
    actor_name: input.actorName,
    action: input.action,
    entity_type: input.entityType,
    notion_page_id: null,
    changed_fields: {
      ...(input.changedFields ?? {}),
      entity_id: input.entityId,
    },
    operation_source: input.operationSource ?? "app",
    request_id: input.requestId ?? null,
    batch_id: input.batchId ?? null,
  });
  if (error) {
    throw new Error(`prospect audit failed: ${error.message}`);
  }
}
