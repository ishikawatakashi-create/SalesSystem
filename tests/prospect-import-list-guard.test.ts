import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import {
  assertProspectListAcceptsImport,
  isTerminalProspectImportErrorMessage,
  PROSPECT_IMPORT_LIST_CHECK_FAILED_MESSAGE,
  PROSPECT_IMPORT_LIST_UNAVAILABLE_MESSAGE,
} from "@/lib/prospects/import";

function adminFor(result: {
  data: unknown;
  error: null | { message: string };
}) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
  };
  return {
    admin: { from: vi.fn(() => builder) },
    builder,
  };
}

describe("prospect CSV import list guard", () => {
  it.each(["draft", "active", "paused"])(
    "allows the non-archived %s status",
    async (status) => {
      const { admin } = adminFor({
        data: { id: "list-1", status, archived_at: null },
        error: null,
      });

      await expect(
        assertProspectListAcceptsImport("list-1", { admin: admin as never }),
      ).resolves.toBeUndefined();
    },
  );

  it.each([
    { id: "list-1", status: "archived", archived_at: null },
    {
      id: "list-1",
      status: "active",
      archived_at: "2026-08-11T00:00:00.000Z",
    },
    null,
  ])("rejects a missing or archived list", async (data) => {
    const { admin } = adminFor({ data, error: null });

    await expect(
      assertProspectListAcceptsImport("list-1", { admin: admin as never }),
    ).rejects.toThrow(PROSPECT_IMPORT_LIST_UNAVAILABLE_MESSAGE);
  });

  it("maps a list lookup failure to a user-facing message", async () => {
    const { admin } = adminFor({
      data: null,
      error: { message: "database detail" },
    });

    await expect(
      assertProspectListAcceptsImport("list-1", { admin: admin as never }),
    ).rejects.toThrow(PROSPECT_IMPORT_LIST_CHECK_FAILED_MESSAGE);
  });

  it("treats archived-list failures as terminal worker errors", () => {
    expect(
      isTerminalProspectImportErrorMessage(
        PROSPECT_IMPORT_LIST_UNAVAILABLE_MESSAGE,
      ),
    ).toBe(true);
    expect(isTerminalProspectImportErrorMessage("temporary failure")).toBe(
      false,
    );
  });

  it("wires the guard into page, upload, prepare, commit and chunk execution", () => {
    const importSource = readFileSync(
      resolve(process.cwd(), "src/lib/prospects/import.ts"),
      "utf8",
    );
    const actionSource = readFileSync(
      resolve(process.cwd(), "src/features/prospects/actions.ts"),
      "utf8",
    );
    const pageSource = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(main)/prospect-lists/[id]/import/page.tsx",
      ),
      "utf8",
    );

    expect(importSource).toContain(
      "await assertProspectListAcceptsImport(input.listId, { admin })",
    );
    expect(importSource.match(/assertImportJobListAcceptsImport\(/g)?.length).toBeGreaterThanOrEqual(7);
    expect(actionSource).toContain("expectedListId: input.listId");
    expect(pageSource).toContain(
      'list.archived_at || list.status === "archived"',
    );
  });
});
