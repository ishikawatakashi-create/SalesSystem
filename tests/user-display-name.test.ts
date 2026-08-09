import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DISPLAY_NAME_MAX_LENGTH,
  isFixtureUserAccount,
  validateDisplayName,
} from "@/lib/auth/display-name";
import {
  APP_ROLE_LABELS,
  getAppRoleLabel,
} from "@/lib/auth/role-labels";

describe("display_name validation", () => {
  it("trims and accepts normal names", () => {
    const r = validateDisplayName("  石川 高志  ");
    expect(r).toEqual({ ok: true, value: "石川 高志" });
  });

  it("rejects empty / whitespace", () => {
    expect(validateDisplayName("").ok).toBe(false);
    expect(validateDisplayName("   ").ok).toBe(false);
    expect(validateDisplayName(null).ok).toBe(false);
  });

  it("rejects over max length", () => {
    const r = validateDisplayName("あ".repeat(DISPLAY_NAME_MAX_LENGTH + 1));
    expect(r.ok).toBe(false);
  });

  it("allows same name for multiple users (no uniqueness in validator)", () => {
    expect(validateDisplayName("同名ユーザー").ok).toBe(true);
  });

  it("keeps HTML/script as plain text (not executed; React text-escape on render)", () => {
    const r = validateDisplayName(`<script>alert(1)</script>`);
    expect(r).toEqual({
      ok: true,
      value: `<script>alert(1)</script>`,
    });
  });
});

describe("fixture user detection", () => {
  it("detects example.invalid and known test prefixes", () => {
    expect(isFixtureUserAccount({ email: "spike-a@example.invalid" })).toBe(
      true,
    );
    expect(isFixtureUserAccount({ email: "test_ui@example.invalid" })).toBe(
      true,
    );
    expect(
      isFixtureUserAccount({ email: "test_phase1_it.a@example.invalid" }),
    ).toBe(true);
  });

  it("does not treat corporate emails as fixture by display name", () => {
    expect(
      isFixtureUserAccount({
        email: "taro@il.co.jp",
      }),
    ).toBe(false);
  });

  it("hides fixtures by email metadata, not display_name", () => {
    expect(isFixtureUserAccount({ email: "real@company.jp" })).toBe(false);
    // display_name は引数に無い（意図的）
  });
});

describe("invite active grouping", () => {
  it("counts only pending and unexpired invitations", async () => {
    const { countActivePendingInvitations } = await import(
      "@/lib/auth/invitation-status"
    );
    const now = Date.parse("2026-08-09T00:00:00.000Z");
    expect(
      countActivePendingInvitations(
        [
          { status: "pending", expires_at: "2026-08-10T00:00:00.000Z" },
          { status: "pending", expires_at: "2026-08-01T00:00:00.000Z" },
          { status: "accepted", expires_at: "2026-08-20T00:00:00.000Z" },
          { status: "expired", expires_at: "2026-08-20T00:00:00.000Z" },
        ],
        now,
      ),
    ).toBe(1);
  });
});

describe("role UI labels", () => {
  it("maps internal roles to Japanese labels", () => {
    expect(APP_ROLE_LABELS.admin).toBe("管理者");
    expect(APP_ROLE_LABELS.a).toBe("運用責任者");
    expect(APP_ROLE_LABELS.b).toBe("担当者");
    expect(APP_ROLE_LABELS.viewer).toBe("閲覧者");
    expect(getAppRoleLabel("a")).toBe("運用責任者");
  });

  it("keeps internal role codes unchanged", () => {
    expect(Object.keys(APP_ROLE_LABELS).sort()).toEqual(
      ["a", "admin", "b", "viewer"].sort(),
    );
  });
});

type UserRow = {
  id: string;
  display_name: string;
  email: string;
  role: string;
};

describe("updateUserDisplayName permissions", () => {
  let users: Map<string, UserRow>;
  let audits: Array<{
    action: string;
    actor_id: string;
    changed_fields: Record<string, string>;
  }>;

  beforeEach(() => {
    vi.resetModules();
    users = new Map([
      [
        "admin-1",
        {
          id: "admin-1",
          display_name: "管理者",
          email: "a@x.jp",
          role: "admin",
        },
      ],
      [
        "user-b",
        {
          id: "user-b",
          display_name: "担当B",
          email: "b@x.jp",
          role: "b",
        },
      ],
      [
        "user-a",
        {
          id: "user-a",
          display_name: "運用A",
          email: "op@x.jp",
          role: "a",
        },
      ],
      [
        "user-v",
        {
          id: "user-v",
          display_name: "閲覧V",
          email: "v@x.jp",
          role: "viewer",
        },
      ],
    ]);
    audits = [];

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => {
          if (table === "app_users") {
            return {
              select: () => ({
                eq: (_c: string, id: string) => ({
                  maybeSingle: async () => ({
                    data: users.get(id) ?? null,
                    error: null,
                  }),
                }),
              }),
              update: (patch: { display_name: string }) => ({
                eq: async (_c: string, id: string) => {
                  const u = users.get(id);
                  if (u) u.display_name = patch.display_name;
                  return { error: null };
                },
              }),
            };
          }
          if (table === "audit_logs") {
            return {
              insert: async (row: {
                action: string;
                actor_id: string;
                changed_fields: Record<string, string>;
              }) => {
                audits.push(row);
                return { error: null };
              },
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
        auth: {
          admin: {
            updateUserById: async () => ({ data: {}, error: null }),
          },
        },
      }),
    }));
  });

  it("admin can rename self and other", async () => {
    const { updateUserDisplayName } = await import(
      "@/lib/auth/update-display-name"
    );

    const self = await updateUserDisplayName({
      actor: { id: "admin-1", role: "admin", display_name: "管理者" },
      targetUserId: "admin-1",
      displayName: "管理者 改",
    });
    expect(self.ok).toBe(true);

    const other = await updateUserDisplayName({
      actor: { id: "admin-1", role: "admin", display_name: "管理者 改" },
      targetUserId: "user-b",
      displayName: "新担当",
    });
    expect(other.ok).toBe(true);
    expect(users.get("user-b")?.display_name).toBe("新担当");
  });

  it("a/b/viewer can rename self only", async () => {
    const { updateUserDisplayName } = await import(
      "@/lib/auth/update-display-name"
    );

    for (const [id, role] of [
      ["user-a", "a"],
      ["user-b", "b"],
      ["user-v", "viewer"],
    ] as const) {
      const ok = await updateUserDisplayName({
        actor: {
          id,
          role,
          display_name: users.get(id)!.display_name,
        },
        targetUserId: id,
        displayName: `自分_${role}`,
      });
      expect(ok.ok, role).toBe(true);

      const denied = await updateUserDisplayName({
        actor: { id, role, display_name: `自分_${role}` },
        targetUserId: "admin-1",
        displayName: "乗っ取り",
      });
      expect(denied.ok, `${role} other`).toBe(false);
      if (!denied.ok) {
        expect(denied.message).toContain("他のユーザー");
      }
    }
  });

  it("writes audit with actor/target/old/new", async () => {
    const { updateUserDisplayName } = await import(
      "@/lib/auth/update-display-name"
    );
    await updateUserDisplayName({
      actor: { id: "admin-1", role: "admin", display_name: "管理者" },
      targetUserId: "user-a",
      displayName: "運用責任者 改",
    });
    expect(audits.length).toBeGreaterThan(0);
    const last = audits[audits.length - 1]!;
    expect(last.action).toBe("user.display_name_change");
    expect(last.actor_id).toBe("admin-1");
    expect(last.changed_fields.target_user_id).toBe("user-a");
    expect(last.changed_fields.old_display_name).toBe("運用A");
    expect(last.changed_fields.new_display_name).toBe("運用責任者 改");
  });
});

describe("Gmail reply template uses actor display name", () => {
  it("embeds provided display name", async () => {
    const { buildInquiryReplyDraftBody } = await import(
      "@/lib/inquiries/reply-template"
    );
    const body = buildInquiryReplyDraftBody({
      companyName: "株式会社テスト",
      senderName: "山田",
      actorDisplayName: "石川 高志",
      messageText: "hello",
    });
    expect(body).toContain("株式会社イルの石川 高志です");
    expect(body).not.toContain("初期管理者");
  });
});
