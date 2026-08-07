import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/sync/activity-write-pipeline", () => ({
  activityCreate: vi.fn(),
  isActivitySyncError: (e: unknown) =>
    Boolean(e && typeof e === "object" && "code" in e),
}));

import { bulkCreateActivities } from "@/lib/activities/bulk-create";
import { activityCreate } from "@/lib/sync/activity-write-pipeline";
import { uuidV5 } from "@/lib/notion/ids";
import type { ActivityWriteInput } from "@/lib/activities/types";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";

function rowInput(over: Partial<ActivityWriteInput> = {}): ActivityWriteInput {
  return {
    title: "bulk row",
    customerPageId: CUSTOMER,
    dealPageId: null,
    contactPageIds: [],
    activityAt: "2026-08-07T10:00:00.000Z",
    categoryPageIds: [],
    summary: null,
    nextActionNote: null,
    nextActionDate: null,
    body: "body",
    batchId: null,
    ...over,
  };
}

describe("bulkCreateActivities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("行ごとに独立requestIdで作成し、失敗行だけerrorになる", async () => {
    vi.mocked(activityCreate)
      .mockResolvedValueOnce({
        status: "completed",
        requestId: "r1",
        externalId: "e1",
        notionPageId: "p1",
      })
      .mockRejectedValueOnce({ code: "validation", message: "bad" })
      .mockResolvedValueOnce({
        status: "completed",
        requestId: "r3",
        externalId: "e3",
        notionPageId: "p3",
      });

    const result = await bulkCreateActivities({
      actorId: "actor",
      actorName: "Actor",
      batch: {
        batchRequestId: "batch-1",
        common: { categoryPageIds: [] },
        rows: [
          {
            rowId: "row-1",
            requestId: "11111111-1111-4111-8111-000000000001",
            input: rowInput({ title: "ok1" }),
          },
          {
            rowId: "row-2",
            requestId: "11111111-1111-4111-8111-000000000002",
            input: rowInput({ title: "bad" }),
          },
          {
            rowId: "row-3",
            requestId: "11111111-1111-4111-8111-000000000003",
            input: rowInput({ title: "ok3" }),
          },
        ],
      },
    });

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]?.status).toBe("completed");
    expect(result.rows[1]?.status).toBe("error");
    expect(result.rows[1]?.errorCode).toBe("validation");
    expect(result.rows[2]?.status).toBe("completed");
    expect(activityCreate).toHaveBeenCalledTimes(3);
  });

  it("external_idは行ごとに異なり、再試行時も決定的", () => {
    const batchId = "batch-retry";
    const id1 = uuidV5(`activity:bulk:${batchId}:row-1:${CUSTOMER}`);
    const id2 = uuidV5(`activity:bulk:${batchId}:row-2:${CUSTOMER}`);
    expect(id1).not.toBe(id2);
    expect(uuidV5(`activity:bulk:${batchId}:row-1:${CUSTOMER}`)).toBe(id1);
  });

  it("失敗行のみ再試行でき、成功行は呼ばない想定を検証", async () => {
    vi.mocked(activityCreate).mockResolvedValue({
      status: "completed",
      requestId: "r2",
      externalId: "e2",
      notionPageId: "p2",
    });

    const retry = await bulkCreateActivities({
      actorId: "actor",
      actorName: "Actor",
      batch: {
        batchRequestId: "batch-1",
        rows: [
          {
            rowId: "row-2",
            requestId: "11111111-1111-4111-8111-000000000002",
            input: rowInput({ title: "retry-ok" }),
          },
        ],
      },
    });
    expect(retry.rows[0]?.status).toBe("completed");
    expect(activityCreate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(activityCreate).mock.calls[0]?.[0].requestId).toBe(
      "11111111-1111-4111-8111-000000000002",
    );
  });
});
