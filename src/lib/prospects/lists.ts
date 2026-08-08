import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { writeProspectAudit } from "@/lib/prospects/audit";
import type {
  ProspectListRow,
  ProspectListStats,
  ProspectListStatus,
  ProspectSourceType,
} from "@/lib/prospects/types";

export async function createProspectList(input: {
  name: string;
  description?: string | null;
  sourceType?: ProspectSourceType;
  sourceName?: string | null;
  ownerUserId?: string | null;
  status?: ProspectListStatus;
  actorId: string;
  actorName: string;
}): Promise<ProspectListRow> {
  const admin = createAdminClient();
  const name = input.name.trim();
  if (!name) throw new Error("リスト名は必須です");

  const { data, error } = await admin
    .from("prospect_lists")
    .insert({
      name,
      description: input.description?.trim() || null,
      source_type: input.sourceType ?? "csv",
      source_name: input.sourceName?.trim() || null,
      owner_user_id: input.ownerUserId ?? input.actorId,
      status: input.status ?? "active",
      created_by: input.actorId,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "list create failed");
  const row = data as unknown as ProspectListRow;

  await writeProspectAudit({
    actorId: input.actorId,
    actorName: input.actorName,
    action: "prospect_list.created",
    entityType: "prospect_list",
    entityId: row.id,
    changedFields: { name, status: row.status },
  });
  return row;
}

export async function updateProspectList(input: {
  id: string;
  patch: Partial<{
    name: string;
    description: string | null;
    status: ProspectListStatus;
    sourceType: ProspectSourceType;
    sourceName: string | null;
    ownerUserId: string | null;
  }>;
  actorId: string;
  actorName: string;
}): Promise<ProspectListRow> {
  const admin = createAdminClient();
  const update: Record<string, unknown> = {};
  if (input.patch.name != null) update.name = input.patch.name.trim();
  if (input.patch.description !== undefined) {
    update.description = input.patch.description?.trim() || null;
  }
  if (input.patch.status != null) {
    update.status = input.patch.status;
    if (input.patch.status === "archived") {
      update.archived_at = new Date().toISOString();
    }
  }
  if (input.patch.sourceType != null) update.source_type = input.patch.sourceType;
  if (input.patch.sourceName !== undefined) {
    update.source_name = input.patch.sourceName?.trim() || null;
  }
  if (input.patch.ownerUserId !== undefined) {
    update.owner_user_id = input.patch.ownerUserId;
  }

  const { data, error } = await admin
    .from("prospect_lists")
    .update(update)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "list update failed");
  const row = data as unknown as ProspectListRow;

  await writeProspectAudit({
    actorId: input.actorId,
    actorName: input.actorName,
    action:
      input.patch.status === "archived"
        ? "prospect_list.archived"
        : "prospect_list.updated",
    entityType: "prospect_list",
    entityId: input.id,
    changedFields: update,
  });
  return row;
}

export async function listProspectLists(input?: {
  includeArchived?: boolean;
}): Promise<ProspectListRow[]> {
  const admin = createAdminClient();
  let q = admin
    .from("prospect_lists")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (!input?.includeArchived) {
    q = q.is("archived_at", null).neq("status", "archived");
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ProspectListRow[];
}

export async function getProspectList(id: string): Promise<ProspectListRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("prospect_lists")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProspectListRow | null) ?? null;
}

export async function fetchProspectListStats(
  listIds: string[],
): Promise<Map<string, ProspectListStats>> {
  const map = new Map<string, ProspectListStats>();
  if (listIds.length === 0) return map;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("prospect_list_stats", {
    p_list_ids: listIds,
  });
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ProspectListStats[]) {
    map.set(row.prospect_list_id, {
      ...row,
      total_count: Number(row.total_count),
      unassigned_count: Number(row.unassigned_count),
      assigned_count: Number(row.assigned_count),
      working_count: Number(row.working_count),
      qualified_count: Number(row.qualified_count),
      disqualified_count: Number(row.disqualified_count),
      dnc_count: Number(row.dnc_count),
      duplicate_review_count: Number(row.duplicate_review_count),
    });
  }
  return map;
}
