export const CALL_QUEUE_ELIGIBLE_STAGES = [
  "new",
  "assigned",
  "working",
] as const;

export const CALL_QUEUE_BLOCKING_PROMOTION_STATUSES = [
  "completed",
  "pending",
  "organization_created",
  "contacts_done",
  "activity_done",
  "action_done",
] as const;

export type CallQueueEligibilityFailure =
  | "membership_archived"
  | "membership_prospect_mismatch"
  | "membership_not_assigned_to_user"
  | "membership_stage_ineligible"
  | "prospect_archived"
  | "prospect_do_not_contact"
  | "prospect_promotion_ineligible"
  | "call_claim_conflict";

export type CallQueueEligibilitySnapshot = {
  membership: {
    prospectId: string;
    assignedUserId: string | null;
    stage: string;
    archivedAt: string | null;
    claimedBy: string | null;
    claimExpiresAt: string | null;
  };
  prospect: {
    archivedAt: string | null;
    doNotContact: boolean;
    promotionStatus: string | null;
  };
};

export function getCallQueueEligibilityFailure(input: {
  snapshot: CallQueueEligibilitySnapshot;
  userId: string;
  expectedProspectId?: string | null;
  requireAvailableClaim?: boolean;
  now?: Date;
}): CallQueueEligibilityFailure | null {
  const { membership, prospect } = input.snapshot;

  if (membership.archivedAt) return "membership_archived";
  if (
    input.expectedProspectId &&
    membership.prospectId !== input.expectedProspectId
  ) {
    return "membership_prospect_mismatch";
  }
  if (prospect.archivedAt) return "prospect_archived";
  if (prospect.doNotContact !== false) return "prospect_do_not_contact";
  if (
    CALL_QUEUE_BLOCKING_PROMOTION_STATUSES.includes(
      (prospect.promotionStatus ??
        "none") as (typeof CALL_QUEUE_BLOCKING_PROMOTION_STATUSES)[number],
    )
  ) {
    return "prospect_promotion_ineligible";
  }
  if (membership.assignedUserId !== input.userId) {
    return "membership_not_assigned_to_user";
  }
  if (
    !CALL_QUEUE_ELIGIBLE_STAGES.includes(
      membership.stage as (typeof CALL_QUEUE_ELIGIBLE_STAGES)[number],
    )
  ) {
    return "membership_stage_ineligible";
  }

  if (input.requireAvailableClaim && membership.claimedBy) {
    const isOtherUser = membership.claimedBy !== input.userId;
    const expiresAtMs = membership.claimExpiresAt
      ? new Date(membership.claimExpiresAt).getTime()
      : null;
    const nowMs = (input.now ?? new Date()).getTime();
    const hasActiveOrInvalidLease =
      expiresAtMs !== null &&
      (!Number.isFinite(expiresAtMs) || expiresAtMs >= nowMs);
    if (isOtherUser && hasActiveOrInvalidLease) {
      return "call_claim_conflict";
    }
  }

  return null;
}
