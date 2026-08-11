import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { writeProspectAudit } from "@/lib/prospects/audit";
import {
  MANUAL_PROSPECT_MEMBERSHIP_STAGES,
  type ProspectListMembershipRow,
  type ProspectMembershipStage,
} from "@/lib/prospects/types";

export async function setMembershipAssignee(input: {
  membershipId: string;
  assignedUserId: string | null;
  actorId: string;
  actorName: string;
  /** new→assigned only when currently new and assigning someone */
  autoStageOnAssign?: boolean;
}): Promise<ProspectListMembershipRow> {
  const admin = createAdminClient();
  const { data: current, error: readErr } = await admin
    .from("prospect_list_memberships")
    .select("*")
    .eq("id", input.membershipId)
    .is("archived_at", null)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!current) throw new Error("membership not found");

  if (input.assignedUserId) {
    const { data: assignee, error: assigneeError } = await admin
      .from("app_users")
      .select("id,is_active")
      .eq("id", input.assignedUserId)
      .maybeSingle();
    if (assigneeError || !assignee?.is_active) {
      throw new Error("利用停止中のユーザーは新しい担当者に指定できません");
    }
  }

  const patch: Record<string, unknown> = {
    assigned_user_id: input.assignedUserId,
  };
  if (
    input.autoStageOnAssign !== false &&
    input.assignedUserId &&
    current.stage === "new"
  ) {
    patch.stage = "assigned";
  }

  const { data, error } = await admin
    .from("prospect_list_memberships")
    .update(patch)
    .eq("id", input.membershipId)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "assign failed");

  await writeProspectAudit({
    actorId: input.actorId,
    actorName: input.actorName,
    action: "prospect_membership.assigned",
    entityType: "prospect_membership",
    entityId: input.membershipId,
    changedFields: {
      assigned_user_id: input.assignedUserId,
      stage: data.stage,
      prospect_id: data.prospect_id,
      prospect_list_id: data.prospect_list_id,
    },
  });
  return data as ProspectListMembershipRow;
}

export async function setMembershipStage(input: {
  membershipId: string;
  stage: ProspectMembershipStage;
  actorId: string;
  actorName: string;
}): Promise<ProspectListMembershipRow> {
  const requestedStage = String(input.stage);
  if (requestedStage === "converted") {
    throw new Error(
      "「正式組織化済み」は正式な組織への登録処理でのみ設定できます",
    );
  }
  if (
    !MANUAL_PROSPECT_MEMBERSHIP_STAGES.includes(
      requestedStage as (typeof MANUAL_PROSPECT_MEMBERSHIP_STAGES)[number],
    )
  ) {
    throw new Error(
      "指定された対応状況は利用できません。画面を再読み込みしてください。",
    );
  }
  const stage = requestedStage as (typeof MANUAL_PROSPECT_MEMBERSHIP_STAGES)[number];

  const admin = createAdminClient();
  const { data: current, error: readError } = await admin
    .from("prospect_list_memberships")
    .select("id,prospect_id,stage")
    .eq("id", input.membershipId)
    .is("archived_at", null)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) {
    throw new Error(
      "対象が見つからないため更新できません。画面を再読み込みしてください。",
    );
  }

  if (current.stage === "converted") {
    throw new Error(
      "正式な組織に登録済みのため、対応状況は変更できません",
    );
  }

  const prospectId =
    typeof current.prospect_id === "string" ? current.prospect_id : "";
  if (!prospectId) {
    throw new Error(
      "対象が見つからないため更新できません。画面を再読み込みしてください。",
    );
  }

  const { data: prospect, error: prospectReadError } = await admin
    .from("prospects")
    .select("promotion_status")
    .eq("id", prospectId)
    .maybeSingle();
  if (prospectReadError) throw new Error(prospectReadError.message);
  if (!prospect) {
    throw new Error(
      "対象が見つからないため更新できません。画面を再読み込みしてください。",
    );
  }
  if (prospect.promotion_status === "completed") {
    throw new Error(
      "正式な組織に登録済みのため、対応状況は変更できません",
    );
  }

  const { data, error } = await admin
    .from("prospect_list_memberships")
    .update({ stage })
    .eq("id", input.membershipId)
    .is("archived_at", null)
    .neq("stage", "converted")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      "対応状況が更新されたため、画面を再読み込みして確認してください",
    );
  }

  await writeProspectAudit({
    actorId: input.actorId,
    actorName: input.actorName,
    action: "prospect_membership.stage_changed",
    entityType: "prospect_membership",
    entityId: input.membershipId,
    changedFields: {
      stage,
      prospect_id: data.prospect_id,
      prospect_list_id: data.prospect_list_id,
    },
  });
  return data as ProspectListMembershipRow;
}

/**
 * Bulk assign. Default: unassigned only (no overwrite).
 * Chunked by caller / job — this processes one batch transactionally.
 */
export async function bulkAssignMemberships(input: {
  membershipIds: string[];
  assigneeUserIds: string[];
  mode: "single" | "equal";
  onlyUnassigned?: boolean;
  overwrite?: boolean;
  actorId: string;
  actorName: string;
  batchId?: string;
}): Promise<{ updated: number; skipped: number }> {
  if (input.assigneeUserIds.length === 0) {
    throw new Error("担当者が必要です");
  }
  if (input.mode === "single" && input.assigneeUserIds.length !== 1) {
    throw new Error(
      "1人にまとめて割り当てる場合は、自社担当者を1人だけ選択してください",
    );
  }
  const admin = createAdminClient();
  const onlyUnassigned = input.onlyUnassigned !== false;
  const overwrite = input.overwrite === true;

  // Validate assignees are active
  const { data: users, error: userErr } = await admin
    .from("app_users")
    .select("id,is_active")
    .in("id", input.assigneeUserIds);
  if (userErr) throw new Error(userErr.message);
  const activeIds = new Set(
    (users ?? [])
      .filter((u) => u.is_active)
      .map((u) => u.id as string),
  );
  const assignees = input.assigneeUserIds.filter((id) => activeIds.has(id));
  if (assignees.length === 0) {
    throw new Error("有効な担当者がいません");
  }

  const { data: rows, error } = await admin
    .from("prospect_list_memberships")
    .select("id,assigned_user_id,stage")
    .in("id", input.membershipIds)
    .is("archived_at", null);
  if (error) throw new Error(error.message);

  const targets = (rows ?? []).filter((r) => {
    if (overwrite) return true;
    if (onlyUnassigned) return r.assigned_user_id == null;
    return r.assigned_user_id == null;
  });

  let updated = 0;
  let skipped = (rows ?? []).length - targets.length;
  let i = 0;
  for (const row of targets) {
    const assignee =
      input.mode === "equal"
        ? assignees[i % assignees.length]!
        : assignees[0]!;
    i += 1;
    const patch: Record<string, unknown> = {
      assigned_user_id: assignee,
    };
    if (row.stage === "new") patch.stage = "assigned";
    const { error: updErr } = await admin
      .from("prospect_list_memberships")
      .update(patch)
      .eq("id", String(row.id));
    if (updErr) {
      skipped += 1;
      continue;
    }
    updated += 1;
  }

  await writeProspectAudit({
    actorId: input.actorId,
    actorName: input.actorName,
    action: "prospect_membership.bulk_assigned",
    entityType: "prospect_membership",
    entityId: input.batchId ?? input.membershipIds[0] ?? "bulk",
    batchId: input.batchId ?? null,
    changedFields: {
      updated,
      skipped,
      mode: input.mode,
      only_unassigned: onlyUnassigned,
      assignee_count: assignees.length,
      membership_count: input.membershipIds.length,
    },
  });

  return { updated, skipped };
}
