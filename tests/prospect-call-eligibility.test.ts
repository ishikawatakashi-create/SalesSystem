import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("test must inject an admin client");
  }),
}));

vi.mock("@/lib/prospects/audit", () => ({
  writeProspectAudit: vi.fn(),
}));

vi.mock("@/lib/prospects/dnc", () => ({
  setProspectDoNotContact: vi.fn(),
}));

import {
  CALL_QUEUE_BLOCKING_PROMOTION_STATUSES,
  getCallQueueEligibilityFailure,
  type CallQueueEligibilitySnapshot,
} from "@/lib/prospects/call-eligibility";
import {
  claimNextProspectCall,
  ensureCallClaimForUser,
  loadCallWorkspace,
} from "@/lib/prospects/call-queue";
import { getCallErrorMessage } from "@/lib/prospects/call-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CALL_QUEUE_FILTERS,
  normalizeCallQueueFilter,
} from "@/lib/prospects/call-filter";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const PROSPECT_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-08-11T03:00:00.000Z");

function eligibilitySnapshot(): CallQueueEligibilitySnapshot {
  return {
    membership: {
      prospectId: PROSPECT_ID,
      assignedUserId: USER_ID,
      stage: "working",
      archivedAt: null,
      claimedBy: null,
      claimExpiresAt: null,
    },
    prospect: {
      archivedAt: null,
      doNotContact: false,
      promotionStatus: "none",
    },
  };
}

const BASE_MEMBERSHIP: Record<string, unknown> = {
  id: MEMBERSHIP_ID,
  prospect_id: PROSPECT_ID,
  prospect_list_id: "55555555-5555-4555-8555-555555555555",
  assigned_user_id: USER_ID,
  stage: "working",
  archived_at: null,
  claimed_by: null,
  claim_expires_at: null,
  next_contact_at: null,
  call_count: 0,
};

const BASE_PROSPECT: Record<string, unknown> = {
  id: PROSPECT_ID,
  archived_at: null,
  do_not_contact: false,
  promotion_status: "none",
};

const INELIGIBLE_SERVER_CASES: Array<{
  label: string;
  membership?: Record<string, unknown>;
  prospect?: Record<string, unknown>;
  reason: string;
}> = [
  {
    label: "wrong assignment",
    membership: { assigned_user_id: OTHER_USER_ID },
    reason: "membership_not_assigned_to_user",
  },
  {
    label: "ineligible stage",
    membership: { stage: "qualified" },
    reason: "membership_stage_ineligible",
  },
  {
    label: "archived membership",
    membership: { archived_at: NOW.toISOString() },
    reason: "membership_archived",
  },
  {
    label: "DNC prospect",
    prospect: { do_not_contact: true },
    reason: "prospect_do_not_contact",
  },
  {
    label: "promotion in progress",
    prospect: { promotion_status: "pending" },
    reason: "prospect_promotion_ineligible",
  },
  {
    label: "archived prospect",
    prospect: { archived_at: NOW.toISOString() },
    reason: "prospect_archived",
  },
];

class MaybeSingleQuery {
  constructor(private readonly row: Record<string, unknown> | null) {}

  select(): this {
    return this;
  }

  eq(): this {
    return this;
  }

  is(): this {
    return this;
  }

  in(): this {
    return this;
  }

  async maybeSingle(): Promise<{
    data: Record<string, unknown> | null;
    error: null;
  }> {
    return { data: this.row, error: null };
  }
}

class UpdateQuery {
  eq(): this {
    return this;
  }

  is(): this {
    return this;
  }

  in(): this {
    return this;
  }

  async select(): Promise<{
    data: Array<{ id: string }>;
    error: null;
  }> {
    return { data: [{ id: MEMBERSHIP_ID }], error: null };
  }
}

function makeAdmin(input: {
  membership?: Record<string, unknown> | null;
  prospect?: Record<string, unknown> | null;
  existingAttempt?: Record<string, unknown> | null;
}) {
  const membership =
    input.membership === undefined ? BASE_MEMBERSHIP : input.membership;
  const prospect =
    input.prospect === undefined ? BASE_PROSPECT : input.prospect;
  const updateMembership = vi.fn(() => new UpdateQuery());
  const insertAttempt = vi.fn(() => {
    throw new Error("attempt insert must not run");
  });

  const admin = {
    from(table: string) {
      if (table === "prospect_list_memberships") {
        return {
          select: () => new MaybeSingleQuery(membership),
          update: updateMembership,
        };
      }
      if (table === "prospects") {
        return {
          select: () => new MaybeSingleQuery(prospect),
        };
      }
      if (table === "prospect_call_attempts") {
        return {
          select: () => new MaybeSingleQuery(input.existingAttempt ?? null),
          insert: insertAttempt,
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { admin, insertAttempt, updateMembership };
}

describe("call queue canonical eligibility", () => {
  it("accepts the canonical eligible states, including failed promotion", () => {
    for (const stage of ["new", "assigned", "working"]) {
      const snapshot = eligibilitySnapshot();
      snapshot.membership.stage = stage;
      snapshot.prospect.promotionStatus = "failed";
      expect(
        getCallQueueEligibilityFailure({ snapshot, userId: USER_ID, now: NOW }),
      ).toBeNull();
    }
  });

  it.each(CALL_QUEUE_BLOCKING_PROMOTION_STATUSES)(
    "rejects canonical blocking promotion status %s",
    (promotionStatus) => {
      const snapshot = eligibilitySnapshot();
      snapshot.prospect.promotionStatus = promotionStatus;
      expect(
        getCallQueueEligibilityFailure({ snapshot, userId: USER_ID, now: NOW }),
      ).toBe("prospect_promotion_ineligible");
    },
  );

  it("rejects wrong assignment, DNC, archives, stage, and prospect mismatch", () => {
    const cases: Array<{
      mutate: (snapshot: CallQueueEligibilitySnapshot) => void;
      expected: string;
      expectedProspectId?: string;
    }> = [
      {
        mutate: (snapshot) => {
          snapshot.membership.assignedUserId = OTHER_USER_ID;
        },
        expected: "membership_not_assigned_to_user",
      },
      {
        mutate: (snapshot) => {
          snapshot.prospect.doNotContact = true;
        },
        expected: "prospect_do_not_contact",
      },
      {
        mutate: (snapshot) => {
          snapshot.membership.archivedAt = NOW.toISOString();
        },
        expected: "membership_archived",
      },
      {
        mutate: (snapshot) => {
          snapshot.prospect.archivedAt = NOW.toISOString();
        },
        expected: "prospect_archived",
      },
      {
        mutate: (snapshot) => {
          snapshot.membership.stage = "qualified";
        },
        expected: "membership_stage_ineligible",
      },
      {
        mutate: () => undefined,
        expected: "membership_prospect_mismatch",
        expectedProspectId: "66666666-6666-4666-8666-666666666666",
      },
    ];

    for (const testCase of cases) {
      const snapshot = eligibilitySnapshot();
      testCase.mutate(snapshot);
      expect(
        getCallQueueEligibilityFailure({
          snapshot,
          userId: USER_ID,
          expectedProspectId: testCase.expectedProspectId,
          now: NOW,
        }),
      ).toBe(testCase.expected);
    }
  });

  it("matches the RPC claim lease rules", () => {
    const activeOtherClaim = eligibilitySnapshot();
    activeOtherClaim.membership.claimedBy = OTHER_USER_ID;
    activeOtherClaim.membership.claimExpiresAt = "2026-08-11T03:01:00.000Z";
    expect(
      getCallQueueEligibilityFailure({
        snapshot: activeOtherClaim,
        userId: USER_ID,
        requireAvailableClaim: true,
        now: NOW,
      }),
    ).toBe("call_claim_conflict");

    const expiredOtherClaim = eligibilitySnapshot();
    expiredOtherClaim.membership.claimedBy = OTHER_USER_ID;
    expiredOtherClaim.membership.claimExpiresAt = "2026-08-11T02:59:59.999Z";
    expect(
      getCallQueueEligibilityFailure({
        snapshot: expiredOtherClaim,
        userId: USER_ID,
        requireAvailableClaim: true,
        now: NOW,
      }),
    ).toBeNull();

    const legacyClaimWithoutExpiry = eligibilitySnapshot();
    legacyClaimWithoutExpiry.membership.claimedBy = OTHER_USER_ID;
    expect(
      getCallQueueEligibilityFailure({
        snapshot: legacyClaimWithoutExpiry,
        userId: USER_ID,
        requireAvailableClaim: true,
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("call queue filter normalization", () => {
  it.each(CALL_QUEUE_FILTERS)("preserves supported filter %s", (filter) => {
    expect(normalizeCallQueueFilter(filter)).toBe(filter);
  });

  it.each([undefined, null, "", "unknown", 0, false, ["all"], { filter: "all" }])(
    "normalizes unsupported value %j to eligible",
    (filter) => {
      expect(normalizeCallQueueFilter(filter)).toBe("eligible");
    },
  );

  it("normalizes again at the RPC boundary", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    await claimNextProspectCall({
      userId: USER_ID,
      actorName: "Test User",
      filter: "tampered-filter",
    });

    expect(rpc).toHaveBeenCalledWith(
      "claim_next_prospect_call",
      expect.objectContaining({ p_filter: "eligible" }),
    );
  });

  it("uses the shared normalizer at every URL, client, and action boundary", () => {
    const paths = [
      "src/app/(main)/call-queue/page.tsx",
      "src/app/(main)/call-queue/[membershipId]/page.tsx",
      "src/features/prospects/claim-start-button.tsx",
      "src/features/prospects/call-workspace.tsx",
      "src/features/prospects/call-actions.ts",
      "src/lib/prospects/call-queue.ts",
    ];
    const sources = paths.map((path) => readFileSync(path, "utf8"));

    for (const source of sources) {
      expect(source).toContain("normalizeCallQueueFilter");
    }
    expect(sources.join("\n")).not.toMatch(/filter:\s*[^,\n]+\s+as\s/);
  });
});

describe("call queue guarded server paths", () => {
  it.each([
    "membership_not_assigned_to_user",
    "membership_stage_ineligible",
    "prospect_do_not_contact",
    "prospect_promotion_ineligible",
    "call_claim_conflict",
    "call_claim_required",
    "prospect_list_archived",
    "actor_inactive",
    "actor_not_provisioned",
    "actor_forbidden",
    "contact_mismatch",
    "request_id_conflict",
    "name_required",
    "contact_create_failed",
    "promotion_in_progress",
    "existing_customer_required",
    "existing_customer_not_found",
  ])("maps internal error code %s to a user-facing message", (code) => {
    const message = getCallErrorMessage(code);
    expect(message).not.toContain(code);
  });

  it("fails closed for unknown database or integration errors", () => {
    expect(getCallErrorMessage("relation secret_table does not exist")).toBe(
      "操作に失敗しました。もう一度お試しください",
    );
  });

  it("does not reveal claim ownership or expiry details to the UI", () => {
    const message =
      "この営業候補は別のユーザーによって更新されました。一覧を更新してください。";
    expect(getCallErrorMessage("call_claim_conflict")).toBe(message);
    expect(getCallErrorMessage("call_claim_required")).toBe(message);
  });

  it.each(INELIGIBLE_SERVER_CASES)(
    "blocks direct membership link for $label",
    async (testCase) => {
      const { admin } = makeAdmin({
        membership: { ...BASE_MEMBERSHIP, ...testCase.membership },
        prospect: { ...BASE_PROSPECT, ...testCase.prospect },
      });
      vi.mocked(createAdminClient).mockReturnValue(admin as never);

      await expect(
        loadCallWorkspace({ membershipId: MEMBERSHIP_ID, userId: USER_ID }),
      ).resolves.toBeNull();
    },
  );

  it("claim refresh trusts current database claim state, not caller hints", async () => {
    const valid = makeAdmin({});
    vi.mocked(createAdminClient).mockReturnValue(valid.admin as never);
    await ensureCallClaimForUser(
      {
        membershipId: MEMBERSHIP_ID,
        userId: USER_ID,
        claimedBy: OTHER_USER_ID,
        claimExpiresAt: "2099-01-01T00:00:00.000Z",
      },
    );
    expect(valid.updateMembership).toHaveBeenCalledTimes(1);
  });

  it.each(INELIGIBLE_SERVER_CASES)(
    "blocks claim refresh for $label",
    async (testCase) => {
      const blocked = makeAdmin({
        membership: { ...BASE_MEMBERSHIP, ...testCase.membership },
        prospect: { ...BASE_PROSPECT, ...testCase.prospect },
      });
      vi.mocked(createAdminClient).mockReturnValue(blocked.admin as never);
      await ensureCallClaimForUser({
        membershipId: MEMBERSHIP_ID,
        userId: USER_ID,
        claimedBy: null,
        claimExpiresAt: null,
      });
      expect(blocked.updateMembership).not.toHaveBeenCalled();
    },
  );

  it("blocks claim refresh for another user's active lease", async () => {
    const claimedMembership = {
      ...BASE_MEMBERSHIP,
      claimed_by: OTHER_USER_ID,
      claim_expires_at: "2099-01-01T00:00:00.000Z",
    };
    const claim = makeAdmin({ membership: claimedMembership });
    vi.mocked(createAdminClient).mockReturnValue(claim.admin as never);
    await ensureCallClaimForUser({
      membershipId: MEMBERSHIP_ID,
      userId: USER_ID,
      claimedBy: null,
      claimExpiresAt: null,
    });
    expect(claim.updateMembership).not.toHaveBeenCalled();
  });
});
