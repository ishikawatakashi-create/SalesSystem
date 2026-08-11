import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requirePermission: vi.fn(),
  saveCallAttempt: vi.fn(),
  claimNextProspectCall: vi.fn(),
  releaseProspectCallClaim: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("@/lib/auth/require", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireUser: mocks.requireUser,
    requirePermission: mocks.requirePermission,
  };
});
vi.mock("@/lib/prospects/call-attempts", () => ({
  saveCallAttempt: mocks.saveCallAttempt,
}));
vi.mock("@/lib/prospects/call-queue", () => ({
  claimNextProspectCall: mocks.claimNextProspectCall,
  releaseProspectCallClaim: mocks.releaseProspectCallClaim,
}));
vi.mock("@/lib/prospects/promote", () => ({
  enqueueProspectPromote: vi.fn(),
  newPromotionRequestId: vi.fn(),
}));
vi.mock("@/lib/prospects/contacts-inline", () => ({
  createProspectContactInline: vi.fn(),
}));

import { saveCallAttemptAction } from "@/features/prospects/call-actions";

const BASE_INPUT = {
  requestId: "11111111-1111-4111-8111-111111111111",
  prospectId: "22222222-2222-4222-8222-222222222222",
  membershipId: "33333333-3333-4333-8333-333333333333",
  result: "no_answer",
};
const workspaceSource = readFileSync(
  resolve(process.cwd(), "src/features/prospects/call-workspace.tsx"),
  "utf8",
);

describe("saveCallAttemptAction commit boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      display_name: "Test User",
    });
    mocks.saveCallAttempt.mockResolvedValue({
      attemptId: "55555555-5555-4555-8555-555555555555",
      duplicated: false,
      stage: "working",
      promoteCtaStrong: false,
    });
    mocks.revalidatePath.mockReturnValue(undefined);
  });

  it("keeps a committed save successful when claim-next fails", async () => {
    mocks.claimNextProspectCall.mockRejectedValue(
      new Error("temporary claim failure"),
    );

    const result = await saveCallAttemptAction({
      ...BASE_INPUT,
      saveAndNext: true,
      filter: "eligible",
    });

    expect(result).toEqual({
      ok: true,
      attemptId: "55555555-5555-4555-8555-555555555555",
      duplicated: false,
      stage: "working",
      promoteCtaStrong: false,
      nextMembershipId: null,
      emptyQueue: false,
      nextClaimFailed: true,
    });
  });

  it("keeps a committed save successful when cache invalidation fails", async () => {
    mocks.revalidatePath.mockImplementation(() => {
      throw new Error("cache unavailable");
    });

    const result = await saveCallAttemptAction(BASE_INPUT);

    expect(result).toMatchObject({
      ok: true,
      attemptId: "55555555-5555-4555-8555-555555555555",
      nextClaimFailed: false,
    });
    expect(mocks.claimNextProspectCall).not.toHaveBeenCalled();
  });

  it("still reports a failure when the transactional save itself fails", async () => {
    mocks.saveCallAttempt.mockRejectedValue(new Error("call_claim_required"));

    const result = await saveCallAttemptAction(BASE_INPUT);

    expect(result).toEqual({
      ok: false,
      error:
        "この営業候補は別のユーザーによって更新されました。一覧を更新してください。",
    });
  });

  it("keeps the current workspace closed instead of redirecting to an empty queue after next-claim failure", () => {
    const failureBranch = workspaceSource.indexOf("if (res.nextClaimFailed)");
    const nextBranch = workspaceSource.indexOf("if (res.nextMembershipId)");
    expect(failureBranch).toBeGreaterThan(-1);
    expect(failureBranch).toBeLessThan(nextBranch);
    expect(workspaceSource).toContain("setCallClosed(true)");
    expect(workspaceSource).toContain("架電結果は保存済みですが");
    expect(workspaceSource).toContain(
      "effects?.requireNextContact && (!nextLocal || clearNext)",
    );
    expect(workspaceSource).toContain(
      "架電結果は保存済みですが、次の保存準備に失敗しました。",
    );
  });
});
