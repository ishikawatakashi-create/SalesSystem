"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { saveCallAttempt } from "@/lib/prospects/call-attempts";
import {
  claimNextProspectCall,
  releaseProspectCallClaim,
} from "@/lib/prospects/call-queue";
import {
  enqueueProspectPromote,
  newPromotionRequestId,
  type PromoteMode,
} from "@/lib/prospects/promote";
import type { OrganizationRelationshipSemanticKey } from "@/lib/organizations/relationship";
import { createProspectContactInline } from "@/lib/prospects/contacts-inline";
import { getCallErrorMessage } from "@/lib/prospects/call-errors";
import { normalizeCallQueueFilter } from "@/lib/prospects/call-filter";

function errMsg(e: unknown): string {
  if (e instanceof AuthError) return e.message;
  if (e instanceof Error) {
    return getCallErrorMessage(e.message);
  }
  return "操作に失敗しました";
}

export async function claimNextCallAction(input: {
  listId?: string | null;
  filter?: string | null;
}): Promise<
  | { ok: true; membershipId: string; prospectId: string }
  | { ok: true; empty: true }
  | { ok: false; error: string }
> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.call");
    const claimed = await claimNextProspectCall({
      userId: user.id,
      actorName: user.display_name,
      listId: input.listId,
      filter: normalizeCallQueueFilter(input.filter),
    });
    if (!claimed) return { ok: true, empty: true };
    return {
      ok: true,
      membershipId: claimed.id,
      prospectId: claimed.prospect_id,
    };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function releaseCallClaimAction(input: {
  membershipId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.call");
    await releaseProspectCallClaim({
      membershipId: input.membershipId,
      userId: user.id,
      actorName: user.display_name,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function saveCallAttemptAction(input: {
  requestId: string;
  prospectId: string;
  membershipId: string;
  contactId?: string | null;
  result: string;
  note?: string | null;
  nextContactAt?: string | null;
  clearNextContact?: boolean;
  phoneUsed?: string | null;
  saveAndNext?: boolean;
  listId?: string | null;
  filter?: string | null;
}): Promise<
  | {
      ok: true;
      attemptId: string;
      duplicated: boolean;
      stage: string;
      promoteCtaStrong: boolean;
      nextMembershipId?: string | null;
      emptyQueue?: boolean;
    }
  | { ok: false; error: string }
> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.call");
    const saved = await saveCallAttempt({
      requestId: input.requestId,
      prospectId: input.prospectId,
      membershipId: input.membershipId,
      contactId: input.contactId,
      performedBy: user.id,
      actorName: user.display_name,
      result: input.result,
      note: input.note,
      nextContactAt: input.nextContactAt,
      clearNextContact: input.clearNextContact,
      phoneUsed: input.phoneUsed,
    });

    revalidatePath(`/prospects/${input.prospectId}`);
    if (input.listId) revalidatePath(`/prospect-lists/${input.listId}`);
    revalidatePath("/call-queue");

    let nextMembershipId: string | null = null;
    let emptyQueue = false;
    if (input.saveAndNext) {
      const next = await claimNextProspectCall({
        userId: user.id,
        actorName: user.display_name,
        listId: input.listId,
        filter: normalizeCallQueueFilter(input.filter),
      });
      if (!next) emptyQueue = true;
      else nextMembershipId = next.id;
    }

    return {
      ok: true,
      attemptId: saved.attemptId,
      duplicated: saved.duplicated,
      stage: saved.stage,
      promoteCtaStrong: saved.promoteCtaStrong,
      nextMembershipId,
      emptyQueue,
    };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function addProspectContactInlineAction(input: {
  prospectId: string;
  name: string;
  department?: string | null;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
}): Promise<{ ok: true; contactId: string } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.edit");
    const contact = await createProspectContactInline({
      ...input,
      actorId: user.id,
      actorName: user.display_name,
    });
    revalidatePath(`/prospects/${input.prospectId}`);
    revalidatePath("/call-queue");
    return { ok: true, contactId: contact.id };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function startProspectPromoteAction(input: {
  prospectId: string;
  membershipId?: string | null;
  mode: PromoteMode;
  existingCustomerPageId?: string | null;
  relationshipSemanticKeys?: OrganizationRelationshipSemanticKey[];
  contactIds?: string[];
  copyActivityCount?: 0 | 1 | 3;
  createNextAction?: boolean;
  createDeal?: boolean;
  dealTitle?: string | null;
  dealExpectedAmount?: number | null;
}): Promise<
  | { ok: true; requestId: string; jobId: string }
  | { ok: false; error: string }
> {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.promote");
    requirePermission(user, "customer.edit");
    if ((input.contactIds?.length ?? 0) > 0) {
      requirePermission(user, "contact.edit");
    }
    if ((input.copyActivityCount ?? 0) > 0) {
      requirePermission(user, "activity.edit");
    }
    if (input.createNextAction !== false) {
      requirePermission(user, "action.edit");
    }
    if (input.createDeal) {
      requirePermission(user, "deal.edit");
    }

    const requestId = newPromotionRequestId();
    const { jobId } = await enqueueProspectPromote({
      payload: {
        prospectId: input.prospectId,
        membershipId: input.membershipId ?? null,
        mode: input.mode,
        existingCustomerPageId: input.existingCustomerPageId,
        relationshipSemanticKeys: input.relationshipSemanticKeys,
        contactIds: input.contactIds,
        copyActivityCount: input.copyActivityCount ?? 1,
        createNextAction: input.createNextAction !== false,
        createDeal: Boolean(input.createDeal),
        deal: input.createDeal
          ? {
              title:
                input.dealTitle?.trim() ||
                `${input.prospectId.slice(0, 8)} 案件`,
              expectedAmount: input.dealExpectedAmount ?? null,
            }
          : null,
        actorId: user.id,
        actorName: user.display_name,
        actorStaffPageId: user.notion_staff_page_id,
        requestId,
      },
    });
    revalidatePath(`/prospects/${input.prospectId}`);
    return { ok: true, requestId, jobId };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function newCallRequestIdAction(): Promise<string> {
  return randomUUID();
}
