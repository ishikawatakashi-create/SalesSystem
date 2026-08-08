import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/normalize";
import { writeProspectAudit } from "@/lib/prospects/audit";
import {
  getCallResultSideEffects,
  isCallResult,
  type CallResult,
} from "@/lib/prospects/call-results";
import { setProspectDoNotContact } from "@/lib/prospects/dnc";

export type SaveCallAttemptInput = {
  requestId: string;
  prospectId: string;
  membershipId: string;
  contactId?: string | null;
  performedBy: string;
  actorName: string;
  result: string;
  note?: string | null;
  startedAt?: string | null;
  nextContactAt?: string | null;
  clearNextContact?: boolean;
  phoneUsed?: string | null;
};

export type SaveCallAttemptResult = {
  attemptId: string;
  duplicated: boolean;
  stage: string;
  promoteCtaStrong: boolean;
};

export async function saveCallAttempt(
  input: SaveCallAttemptInput,
): Promise<SaveCallAttemptResult> {
  if (!input.requestId?.trim()) {
    throw new Error("request_id_required");
  }
  if (!isCallResult(input.result)) {
    throw new Error("invalid_call_result");
  }
  const result = input.result as CallResult;
  const effects = getCallResultSideEffects(result);

  if (effects.requireNextContact && !input.nextContactAt && !input.clearNextContact) {
    throw new Error("next_contact_required");
  }

  const admin = createAdminClient();

  // idempotency
  const { data: existing } = await admin
    .from("prospect_call_attempts")
    .select("id,result")
    .eq("request_id", input.requestId)
    .maybeSingle();
  if (existing) {
    const { data: mem } = await admin
      .from("prospect_list_memberships")
      .select("stage")
      .eq("id", input.membershipId)
      .maybeSingle();
    return {
      attemptId: String(existing.id),
      duplicated: true,
      stage: String(mem?.stage ?? "working"),
      promoteCtaStrong: effects.promoteCtaStrong,
    };
  }

  const { data: membership, error: memErr } = await admin
    .from("prospect_list_memberships")
    .select("id,prospect_id,stage,next_contact_at,call_count,archived_at")
    .eq("id", input.membershipId)
    .maybeSingle();
  if (memErr || !membership) throw new Error("membership_not_found");
  if (membership.archived_at) throw new Error("membership_archived");
  if (String(membership.prospect_id) !== input.prospectId) {
    throw new Error("membership_prospect_mismatch");
  }

  const phoneNormalized = input.phoneUsed
    ? normalizePhone(input.phoneUsed)
    : null;
  const completedAt = new Date().toISOString();

  const { data: attempt, error: insErr } = await admin
    .from("prospect_call_attempts")
    .insert({
      prospect_id: input.prospectId,
      membership_id: input.membershipId,
      contact_id: input.contactId ?? null,
      performed_by: input.performedBy,
      result,
      note: input.note?.trim() || null,
      started_at: input.startedAt ?? null,
      completed_at: completedAt,
      next_contact_at: input.clearNextContact
        ? null
        : (input.nextContactAt ?? null),
      clear_next_contact: Boolean(input.clearNextContact),
      phone_used: input.phoneUsed?.trim() || null,
      phone_normalized: phoneNormalized,
      source: "manual_call",
      request_id: input.requestId,
    })
    .select("id")
    .single();
  if (insErr) {
    if (insErr.code === "23505") {
      const { data: again } = await admin
        .from("prospect_call_attempts")
        .select("id")
        .eq("request_id", input.requestId)
        .maybeSingle();
      if (again) {
        return {
          attemptId: String(again.id),
          duplicated: true,
          stage: String(membership.stage),
          promoteCtaStrong: effects.promoteCtaStrong,
        };
      }
    }
    throw new Error(insErr.message);
  }

  let nextStage = String(membership.stage);
  if (effects.membershipStage !== "unchanged") {
    nextStage = effects.membershipStage;
  }

  let nextContactAt: string | null =
    (membership.next_contact_at as string | null) ?? null;
  if (input.clearNextContact) {
    nextContactAt = null;
  } else if (input.nextContactAt) {
    nextContactAt = input.nextContactAt;
  }

  const callCount = Number(membership.call_count ?? 0) + 1;

  const { error: updMemErr } = await admin
    .from("prospect_list_memberships")
    .update({
      stage: nextStage,
      next_contact_at: nextContactAt,
      last_contact_at: completedAt,
      last_call_result: result,
      call_count: callCount,
      claimed_by: null,
      claimed_at: null,
      claim_expires_at: null,
      updated_at: completedAt,
    })
    .eq("id", input.membershipId);
  if (updMemErr) throw new Error(updMemErr.message);

  if (effects.setDoNotContact) {
    await setProspectDoNotContact({
      prospectId: input.prospectId,
      doNotContact: true,
      reason: input.note?.trim() || CALL_RESULT_REASON_DNC,
      actorId: input.performedBy,
      actorName: input.actorName,
    });
  }

  if (effects.setPhoneInvalid) {
    await admin
      .from("prospects")
      .update({
        phone_invalid: true,
        updated_at: completedAt,
      })
      .eq("id", input.prospectId);
  }

  await writeProspectAudit({
    actorId: input.performedBy,
    actorName: input.actorName,
    action: "prospect.call_attempt.create",
    entityType: "prospect",
    entityId: input.prospectId,
    requestId: input.requestId,
    changedFields: {
      attempt_id: attempt.id,
      membership_id: input.membershipId,
      result,
      stage: nextStage,
      next_contact_at: nextContactAt,
      clear_next_contact: Boolean(input.clearNextContact),
      contact_id: input.contactId ?? null,
      has_note: Boolean(input.note?.trim()),
    },
  });

  return {
    attemptId: String(attempt.id),
    duplicated: false,
    stage: nextStage,
    promoteCtaStrong: effects.promoteCtaStrong,
  };
}

const CALL_RESULT_REASON_DNC = "架電結果: 営業連絡不要";

export async function listCallAttempts(input: {
  prospectId: string;
  limit?: number;
  cursorCompletedAt?: string | null;
  cursorId?: string | null;
}): Promise<{
  items: Array<Record<string, unknown>>;
  nextCursor: { completedAt: string; id: string } | null;
}> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const admin = createAdminClient();
  let q = admin
    .from("prospect_call_attempts")
    .select(
      "id,prospect_id,membership_id,contact_id,performed_by,result,note,completed_at,next_contact_at,phone_used,source",
    )
    .eq("prospect_id", input.prospectId)
    .is("archived_at", null)
    .order("completed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (input.cursorCompletedAt && input.cursorId) {
    q = q.or(
      `completed_at.lt.${input.cursorCompletedAt},and(completed_at.eq.${input.cursorCompletedAt},id.lt.${input.cursorId})`,
    );
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items: items as Array<Record<string, unknown>>,
    nextCursor:
      hasMore && last
        ? {
            completedAt: String(last.completed_at),
            id: String(last.id),
          }
        : null,
  };
}
