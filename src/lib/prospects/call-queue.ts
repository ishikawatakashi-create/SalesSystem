import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { writeProspectAudit } from "@/lib/prospects/audit";

export type CallQueueFilter =
  | "eligible"
  | "overdue"
  | "today"
  | "no_schedule"
  | "all";

export type ClaimedMembership = {
  id: string;
  prospect_id: string;
  prospect_list_id: string;
  assigned_user_id: string | null;
  stage: string;
  priority: string | null;
  next_contact_at: string | null;
  last_contact_at: string | null;
  last_call_result: string | null;
  call_count: number;
  claimed_by: string | null;
  claim_expires_at: string | null;
};

export async function claimNextProspectCall(input: {
  userId: string;
  actorName: string;
  listId?: string | null;
  filter?: CallQueueFilter;
  leaseSeconds?: number;
}): Promise<ClaimedMembership | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_next_prospect_call", {
    p_user_id: input.userId,
    p_list_id: input.listId ?? null,
    p_lease_seconds: input.leaseSeconds ?? 600,
    p_filter: input.filter ?? "eligible",
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  const claimed = row as ClaimedMembership;
  await writeProspectAudit({
    actorId: input.userId,
    actorName: input.actorName,
    action: "prospect.call_claim",
    entityType: "prospect_membership",
    entityId: String(claimed.id),
    changedFields: {
      prospect_id: claimed.prospect_id,
      list_id: claimed.prospect_list_id,
      lease_seconds: input.leaseSeconds ?? 600,
      filter: input.filter ?? "eligible",
    },
  });
  return claimed;
}

export async function releaseProspectCallClaim(input: {
  membershipId: string;
  userId: string;
  actorName: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("release_prospect_call_claim", {
    p_membership_id: input.membershipId,
    p_user_id: input.userId,
  });
  if (error) throw new Error(error.message);
  await writeProspectAudit({
    actorId: input.userId,
    actorName: input.actorName,
    action: "prospect.call_claim_release",
    entityType: "prospect_membership",
    entityId: input.membershipId,
  });
}

/** MyDesk / KPI 用の軽量カウント */
export async function countMyCallQueue(input: {
  userId: string;
}): Promise<{
  overdue: number;
  today: number;
  unstarted: number;
}> {
  const admin = createAdminClient();
  const now = new Date();
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jst = new Date(now.getTime() + jstOffsetMs);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const todayStartUtc = new Date(`${y}-${m}-${d}T00:00:00+09:00`).toISOString();
  const tomorrowStartUtc = new Date(
    new Date(`${y}-${m}-${d}T00:00:00+09:00`).getTime() + 86_400_000,
  ).toISOString();

  const base = () =>
    admin
      .from("prospect_list_memberships")
      .select("id,prospects!inner(do_not_contact,promotion_status,archived_at)", {
        count: "exact",
        head: true,
      })
      .eq("assigned_user_id", input.userId)
      .is("archived_at", null)
      .in("stage", ["new", "assigned", "working"])
      .eq("prospects.do_not_contact", false)
      .is("prospects.archived_at", null)
      .not("prospects.promotion_status", "eq", "completed");

  const [overdueRes, todayRes, unstartedRes] = await Promise.all([
    base().lt("next_contact_at", todayStartUtc).not("next_contact_at", "is", null),
    base()
      .gte("next_contact_at", todayStartUtc)
      .lt("next_contact_at", tomorrowStartUtc),
    base().in("stage", ["new", "assigned"]),
  ]);

  return {
    overdue: overdueRes.count ?? 0,
    today: todayRes.count ?? 0,
    unstarted: unstartedRes.count ?? 0,
  };
}

/** Open call screen: refresh lease for current user when allowed */
export async function ensureCallClaimForUser(input: {
  membershipId: string;
  userId: string;
  claimedBy: string | null;
  claimExpiresAt: string | null;
  leaseSeconds?: number;
}): Promise<void> {
  const nowMs = Date.now();
  const expiresMs = input.claimExpiresAt
    ? new Date(input.claimExpiresAt).getTime()
    : 0;
  const canTake =
    !input.claimedBy ||
    input.claimedBy === input.userId ||
    !input.claimExpiresAt ||
    expiresMs < nowMs;
  if (!canTake) return;

  const admin = createAdminClient();
  const lease = Math.max(input.leaseSeconds ?? 600, 60);
  const expires = new Date(nowMs + lease * 1000).toISOString();
  await admin
    .from("prospect_list_memberships")
    .update({
      claimed_by: input.userId,
      claimed_at: new Date(nowMs).toISOString(),
      claim_expires_at: expires,
    })
    .eq("id", input.membershipId)
    .is("archived_at", null);
}

export async function loadCallWorkspace(input: {
  membershipId: string;
  userId: string;
}): Promise<{
  membership: Record<string, unknown>;
  prospect: Record<string, unknown>;
  list: Record<string, unknown>;
  contacts: Array<Record<string, unknown>>;
  recentAttempts: Array<Record<string, unknown>>;
  claimConflict: { byName: string } | null;
} | null> {
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("prospect_list_memberships")
    .select("*")
    .eq("id", input.membershipId)
    .is("archived_at", null)
    .maybeSingle();
  if (!membership) return null;

  const claimedBy = membership.claimed_by as string | null;
  const expires = membership.claim_expires_at
    ? new Date(String(membership.claim_expires_at)).getTime()
    : 0;
  let claimConflict: { byName: string } | null = null;
  if (
    claimedBy &&
    claimedBy !== input.userId &&
    expires > Date.now()
  ) {
    const { data: u } = await admin
      .from("app_users")
      .select("display_name")
      .eq("id", claimedBy)
      .maybeSingle();
    claimConflict = { byName: String(u?.display_name ?? "他ユーザー") };
  }

  const { data: prospect } = await admin
    .from("prospects")
    .select("*")
    .eq("id", String(membership.prospect_id))
    .maybeSingle();
  if (!prospect || prospect.archived_at) return null;

  const { data: list } = await admin
    .from("prospect_lists")
    .select("id,name")
    .eq("id", String(membership.prospect_list_id))
    .maybeSingle();

  const { data: contacts } = await admin
    .from("prospect_contacts")
    .select("*")
    .eq("prospect_id", String(membership.prospect_id))
    .is("archived_at", null)
    .order("is_primary", { ascending: false });

  const { data: recentAttempts } = await admin
    .from("prospect_call_attempts")
    .select(
      "id,result,note,completed_at,next_contact_at,performed_by,membership_id,phone_used",
    )
    .eq("prospect_id", String(membership.prospect_id))
    .is("archived_at", null)
    .order("completed_at", { ascending: false })
    .limit(8);

  return {
    membership: membership as Record<string, unknown>,
    prospect: prospect as Record<string, unknown>,
    list: (list ?? { id: membership.prospect_list_id, name: "" }) as Record<
      string,
      unknown
    >,
    contacts: (contacts ?? []) as Array<Record<string, unknown>>,
    recentAttempts: (recentAttempts ?? []) as Array<Record<string, unknown>>,
    claimConflict,
  };
}
