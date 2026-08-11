import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  writeProspectAudit: vi.fn(),
}));

type QueryResult = {
  data: unknown;
  error: null | { message: string };
};

function query(result: QueryResult) {
  const builder = {
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));

vi.mock("@/lib/prospects/audit", () => ({
  writeProspectAudit: mocks.writeProspectAudit,
}));

import { setMembershipStage } from "@/lib/prospects/memberships";
import { MANUAL_PROSPECT_MEMBERSHIP_STAGES } from "@/lib/prospects/types";

const input = {
  membershipId: "membership-1",
  stage: "working" as const,
  actorId: "actor-1",
  actorName: "担当者",
};

beforeEach(() => {
  mocks.from.mockReset();
  mocks.writeProspectAudit.mockReset();
  mocks.writeProspectAudit.mockResolvedValue(undefined);
});

describe("prospect membership stage guard", () => {
  it("does not expose converted as a manually editable stage", () => {
    expect(MANUAL_PROSPECT_MEMBERSHIP_STAGES).not.toContain("converted");
  });

  it("rejects a manual change to converted before accessing the database", async () => {
    await expect(
      setMembershipStage({ ...input, stage: "converted" }),
    ).rejects.toThrow("正式な組織への登録処理でのみ設定できます");

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.writeProspectAudit).not.toHaveBeenCalled();
  });

  it("rejects an unknown stage before accessing the database", async () => {
    await expect(
      setMembershipStage({
        ...input,
        stage: "unknown-stage" as typeof input.stage,
      }),
    ).rejects.toThrow(
      "指定された対応状況は利用できません。画面を再読み込みしてください。",
    );

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.writeProspectAudit).not.toHaveBeenCalled();
  });

  it("rejects changing a membership whose current stage is converted", async () => {
    mocks.from.mockReturnValueOnce(
      query({
        data: {
          id: input.membershipId,
          prospect_id: "prospect-1",
          stage: "converted",
        },
        error: null,
      }),
    );

    await expect(setMembershipStage(input)).rejects.toThrow(
      "正式な組織に登録済みのため、対応状況は変更できません",
    );

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.writeProspectAudit).not.toHaveBeenCalled();
  });

  it("returns a user-facing message when the membership no longer exists", async () => {
    mocks.from.mockReturnValueOnce(query({ data: null, error: null }));

    await expect(setMembershipStage(input)).rejects.toThrow(
      "対象が見つからないため更新できません。画面を再読み込みしてください。",
    );

    expect(mocks.writeProspectAudit).not.toHaveBeenCalled();
  });

  it("returns a user-facing message when the prospect no longer exists", async () => {
    mocks.from
      .mockReturnValueOnce(
        query({
          data: {
            id: input.membershipId,
            prospect_id: "prospect-1",
            stage: "working",
          },
          error: null,
        }),
      )
      .mockReturnValueOnce(query({ data: null, error: null }));

    await expect(setMembershipStage(input)).rejects.toThrow(
      "対象が見つからないため更新できません。画面を再読み込みしてください。",
    );

    expect(mocks.writeProspectAudit).not.toHaveBeenCalled();
  });

  it("rejects changing a membership for a completed promotion", async () => {
    mocks.from
      .mockReturnValueOnce(
        query({
          data: {
            id: input.membershipId,
            prospect_id: "prospect-1",
            stage: "working",
          },
          error: null,
        }),
      )
      .mockReturnValueOnce(
        query({ data: { promotion_status: "completed" }, error: null }),
      );

    await expect(setMembershipStage(input)).rejects.toThrow(
      "正式な組織に登録済みのため、対応状況は変更できません",
    );

    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(mocks.writeProspectAudit).not.toHaveBeenCalled();
  });

  it("updates and audits a normal stage change", async () => {
    const updateQuery = query({
      data: {
        id: input.membershipId,
        prospect_id: "prospect-1",
        prospect_list_id: "list-1",
        stage: "working",
      },
      error: null,
    });
    mocks.from
      .mockReturnValueOnce(
        query({
          data: {
            id: input.membershipId,
            prospect_id: "prospect-1",
            stage: "assigned",
          },
          error: null,
        }),
      )
      .mockReturnValueOnce(
        query({ data: { promotion_status: "none" }, error: null }),
      )
      .mockReturnValueOnce(updateQuery);

    const result = await setMembershipStage(input);

    expect(result.stage).toBe("working");
    expect(updateQuery.neq).toHaveBeenCalledWith("stage", "converted");
    expect(mocks.writeProspectAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "prospect_membership.stage_changed",
        entityId: input.membershipId,
        changedFields: expect.objectContaining({ stage: "working" }),
      }),
    );
  });
});
