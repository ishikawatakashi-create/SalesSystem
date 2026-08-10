import { describe, expect, it } from "vitest";
import {
  canTransition,
  isInvitationUsable,
  shouldExpire,
} from "@/lib/auth/invitation-logic";
import { splitVisibleInvitations } from "@/lib/auth/invitation-status";
import type { InvitationStatus } from "@/types/database";

const NOW = new Date("2026-08-05T12:00:00Z");
const FUTURE = "2026-08-10T12:00:00Z";
const PAST = "2026-08-01T12:00:00Z";

describe("isInvitationUsable(招待の有効性判定)", () => {
  it("pendingかつ期限内なら利用可能", () => {
    expect(
      isInvitationUsable({ status: "pending", expires_at: FUTURE }, NOW),
    ).toBe(true);
  });

  it("pendingでも期限切れなら利用不可(expiredジョブの実行遅延に依存しない)", () => {
    expect(
      isInvitationUsable({ status: "pending", expires_at: PAST }, NOW),
    ).toBe(false);
  });

  it("accepted / revoked / expired は期限内でも利用不可", () => {
    for (const status of ["accepted", "revoked", "expired"] as const) {
      expect(isInvitationUsable({ status, expires_at: FUTURE }, NOW)).toBe(
        false,
      );
    }
  });
});

describe("canTransition(状態遷移)", () => {
  it("pendingからはaccepted / revoked / expiredへ遷移できる", () => {
    expect(canTransition("pending", "accepted")).toBe(true);
    expect(canTransition("pending", "revoked")).toBe(true);
    expect(canTransition("pending", "expired")).toBe(true);
  });

  it("終端状態(accepted / revoked / expired)からは遷移できない", () => {
    const terminal: InvitationStatus[] = ["accepted", "revoked", "expired"];
    const all: InvitationStatus[] = ["pending", "accepted", "revoked", "expired"];
    for (const from of terminal) {
      for (const to of all) {
        expect(canTransition(from, to), `${from} → ${to} は不可のはず`).toBe(
          false,
        );
      }
    }
  });
});

describe("shouldExpire(期限切れジョブの対象判定)", () => {
  it("pendingかつ期限超過のみが対象", () => {
    expect(shouldExpire({ status: "pending", expires_at: PAST }, NOW)).toBe(true);
    expect(shouldExpire({ status: "pending", expires_at: FUTURE }, NOW)).toBe(
      false,
    );
    expect(shouldExpire({ status: "accepted", expires_at: PAST }, NOW)).toBe(
      false,
    );
    expect(shouldExpire({ status: "revoked", expires_at: PAST }, NOW)).toBe(
      false,
    );
  });
});

describe("招待管理画面の表示分割", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "fixture@example.invalid",
    normalized_email: "fixture@example.invalid",
    display_name: "fixture",
    role: "viewer" as const,
    invited_by: null,
    accepted_at: null,
    revoked_at: null,
    auth_user_id: null,
    archived_at: null,
    archived_by: null,
    auth_cleanup_status: "not_requested" as const,
    auth_cleanup_detail: null,
    created_at: "2026-08-05T00:00:00Z",
  };

  it("cancelled invitation disappears from pending and moves to history", () => {
    const { active, history } = splitVisibleInvitations(
      [{ ...base, status: "revoked", expires_at: FUTURE }],
      NOW.getTime(),
    );
    expect(active).toHaveLength(0);
    expect(history).toHaveLength(1);
  });

  it("archived invitation history is hidden entirely", () => {
    const { active, history } = splitVisibleInvitations(
      [
        {
          ...base,
          status: "accepted",
          expires_at: PAST,
          archived_at: "2026-08-06T00:00:00Z",
        },
      ],
      NOW.getTime(),
    );
    expect(active).toHaveLength(0);
    expect(history).toHaveLength(0);
  });
});
