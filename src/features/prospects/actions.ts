"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { hasPermission } from "@/lib/auth/permissions";
import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { enqueueJob } from "@/lib/jobs/queue";
import { setProspectDoNotContact } from "@/lib/prospects/dnc";
import {
  createProspectImportUpload,
  prepareProspectImport,
  stageAndEnqueueProspectImport,
} from "@/lib/prospects/import";
import type { ProspectColumnMapping } from "@/lib/prospects/import-mapping";
import {
  createProspectList,
  updateProspectList,
} from "@/lib/prospects/lists";
import {
  bulkAssignMemberships,
  setMembershipAssignee,
  setMembershipStage,
} from "@/lib/prospects/memberships";
import type {
  ProspectListStatus,
  ProspectMembershipStage,
  ProspectSourceType,
} from "@/lib/prospects/types";

function errMsg(e: unknown): string {
  if (e instanceof AuthError) return e.message;
  if (e instanceof Error) return e.message;
  return "操作に失敗しました";
}

export async function createProspectListAction(input: {
  name: string;
  description?: string;
  sourceType?: ProspectSourceType;
  sourceName?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.manage_lists");
    const list = await createProspectList({
      name: input.name,
      description: input.description,
      sourceType: input.sourceType,
      sourceName: input.sourceName,
      actorId: user.id,
      actorName: user.display_name,
    });
    revalidatePath("/prospect-lists");
    return { ok: true, id: list.id };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function updateProspectListAction(input: {
  id: string;
  name?: string;
  description?: string | null;
  status?: ProspectListStatus;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.manage_lists");
    await updateProspectList({
      id: input.id,
      patch: {
        name: input.name,
        description: input.description,
        status: input.status,
      },
      actorId: user.id,
      actorName: user.display_name,
    });
    revalidatePath("/prospect-lists");
    revalidatePath(`/prospect-lists/${input.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function setProspectAssigneeAction(input: {
  membershipId: string;
  assignedUserId: string | null;
  listId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    // 単一割当: edit可（B含む）。一括は prospect.assign
    requirePermission(user, "prospect.edit");
    await setMembershipAssignee({
      membershipId: input.membershipId,
      assignedUserId: input.assignedUserId,
      actorId: user.id,
      actorName: user.display_name,
    });
    revalidatePath(`/prospect-lists/${input.listId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function setProspectStageAction(input: {
  membershipId: string;
  stage: ProspectMembershipStage;
  listId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.edit");
    await setMembershipStage({
      membershipId: input.membershipId,
      stage: input.stage,
      actorId: user.id,
      actorName: user.display_name,
    });
    revalidatePath(`/prospect-lists/${input.listId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function bulkAssignProspectsAction(input: {
  membershipIds: string[];
  assigneeUserIds: string[];
  mode: "single" | "equal";
  onlyUnassigned?: boolean;
  overwrite?: boolean;
  listId: string;
}): Promise<{ ok: true; updated: number; skipped: number } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.assign");
    if (input.membershipIds.length === 0) {
      return { ok: false, error: "対象がありません" };
    }
    if (input.membershipIds.length <= 80) {
      const result = await bulkAssignMemberships({
        membershipIds: input.membershipIds,
        assigneeUserIds: input.assigneeUserIds,
        mode: input.mode,
        onlyUnassigned: input.onlyUnassigned,
        overwrite: input.overwrite,
        actorId: user.id,
        actorName: user.display_name,
      });
      revalidatePath(`/prospect-lists/${input.listId}`);
      return { ok: true, ...result };
    }
    const batchId = randomUUID();
    await enqueueJob({
      kind: "prospect_bulk_assign",
      payload: {
        membershipIds: input.membershipIds,
        assigneeUserIds: input.assigneeUserIds,
        mode: input.mode,
        onlyUnassigned: input.onlyUnassigned !== false,
        overwrite: input.overwrite === true,
        actorId: user.id,
        actorName: user.display_name,
        offset: 0,
        batchId,
      },
      priority: 35,
      idempotencyKey: `prospect_bulk_assign:${batchId}:0`,
      createdBy: user.id,
    });
    revalidatePath(`/prospect-lists/${input.listId}`);
    return { ok: true, updated: 0, skipped: 0 };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function setProspectDncAction(input: {
  prospectId: string;
  doNotContact: boolean;
  reason?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.edit");
    await setProspectDoNotContact({
      prospectId: input.prospectId,
      doNotContact: input.doNotContact,
      reason: input.reason,
      actorId: user.id,
      actorName: user.display_name,
    });
    revalidatePath(`/prospects/${input.prospectId}`);
    revalidatePath("/prospects");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function createProspectImportUploadAction(input: {
  listId: string;
  fileName: string;
  fileSize: number;
}): Promise<
  | { ok: true; importJobId: string; signedUploadUrl: string }
  | { ok: false; error: string }
> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.import");
    const result = await createProspectImportUpload({
      userId: user.id,
      listId: input.listId,
      fileName: input.fileName,
      fileSize: input.fileSize,
    });
    return {
      ok: true,
      importJobId: result.importJobId,
      signedUploadUrl: result.signedUploadUrl,
    };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function prepareProspectImportAction(input: {
  importJobId: string;
  mapping?: ProspectColumnMapping;
}): Promise<
  | {
      ok: true;
      headers: string[];
      mapping: ProspectColumnMapping;
      unmapped: string[];
      preview: unknown[];
      totalRows: number;
      encoding: string;
    }
  | { ok: false; error: string }
> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.import");
    const prepared = await prepareProspectImport(input);
    return { ok: true, ...prepared };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function commitProspectImportAction(input: {
  importJobId: string;
  mapping: ProspectColumnMapping;
  listId: string;
}): Promise<{ ok: true; totalRows: number } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.import");
    const result = await stageAndEnqueueProspectImport({
      importJobId: input.importJobId,
      mapping: input.mapping,
      actorId: user.id,
      actorName: user.display_name,
    });
    revalidatePath(`/prospect-lists/${input.listId}`);
    return { ok: true, totalRows: result.totalRows };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function canManageProspectLists(): Promise<boolean> {
  try {
    const user = await requireUser();
    return hasPermission(user.role, "prospect.manage_lists");
  } catch {
    return false;
  }
}
