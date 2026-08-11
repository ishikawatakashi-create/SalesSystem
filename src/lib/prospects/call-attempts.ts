import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/normalize";
import {
  getCallResultSideEffects,
  isCallResult,
} from "@/lib/prospects/call-results";

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
  const result = input.result;
  const effects = getCallResultSideEffects(result);

  if (
    effects.requireNextContact &&
    (!input.nextContactAt || input.clearNextContact)
  ) {
    throw new Error("next_contact_required");
  }

  const note = input.note?.trim() || null;
  const phoneUsed = input.phoneUsed?.trim() || null;
  const phoneNormalized = normalizePhone(phoneUsed);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("save_prospect_call_attempt", {
    p_request_id: input.requestId.trim(),
    p_membership_id: input.membershipId,
    p_prospect_id: input.prospectId,
    p_contact_id: input.contactId ?? null,
    p_performed_by: input.performedBy,
    p_result: result,
    p_note: note,
    p_started_at: input.startedAt ?? null,
    p_next_contact_at: input.clearNextContact
      ? null
      : (input.nextContactAt ?? null),
    p_clear_next_contact: Boolean(input.clearNextContact),
    p_phone_used: phoneUsed,
    p_phone_normalized: phoneNormalized,
  });
  if (error) throw new Error(error.message);

  const saved = data?.[0];
  if (!saved) throw new Error("call_attempt_save_failed");

  return {
    attemptId: String(saved.attempt_id),
    duplicated: Boolean(saved.duplicated),
    stage: String(saved.stage),
    promoteCtaStrong: Boolean(saved.promote_cta_strong),
  };
}

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
