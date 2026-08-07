import { describe, expect, it, vi } from "vitest";

import type { ActionWriteInput, WriteOperationRow } from "@/lib/actions/types";
import { hashActionWriteInput } from "@/lib/actions/input-hash";
import {
  executeActionCreate,
  executeActionUpdate,
  type ActionWriteDeps,
} from "@/lib/sync/action-write-pipeline-core";
import { NotionHttpError } from "@/lib/notion/client-core";
import { todayDateTokyo } from "@/lib/normalize/date-tokyo";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const EXTERNAL = "11111111-1111-4111-8111-111111111111";
const STATUS_OPEN = "11111111-1111-4111-8111-000000000501";
const STATUS_DONE = "11111111-1111-4111-8111-000000000502";

const propsByName = {
  アクション内容: { id: "title", type: "title" },
  external_id: { id: "ext", type: "rich_text" },
  顧客アカウント: { id: "cust", type: "relation" },
  案件: { id: "deal", type: "relation" },
  元対応履歴: { id: "act", type: "relation" },
  自社担当者: { id: "staff", type: "relation" },
  期限: { id: "due", type: "date" },
  状態: { id: "status", type: "relation" },
  優先度: { id: "prio", type: "relation" },
  完了日時: { id: "doneAt", type: "date" },
  作成者ID: { id: "cbid", type: "rich_text" },
  作成者名: { id: "cbname", type: "rich_text" },
};

function sampleInput(over: Partial<ActionWriteInput> = {}): ActionWriteInput {
  return {
    title: "testアクションA",
    customerPageId: CUSTOMER,
    dealPageId: null,
    activityPageId: null,
    staffPageId: null,
    dueDate: "2026-08-10",
    statusPageId: STATUS_OPEN,
    priorityPageId: null,
    completedAt: null,
    ...over,
  };
}

type MockProps = Record<
  string,
  {
    id: string;
    type: string;
    title?: Array<{ plain_text: string }>;
    rich_text?: Array<{ plain_text: string }>;
    relation?: Array<{ id: string }>;
    has_more?: boolean;
    date?: { start: string } | null;
  }
>;

function emptyProps(over?: {
  title?: string;
  externalId?: string;
  statusPageId?: string;
  completedAt?: string | null;
  dueDate?: string;
}): MockProps {
  const rich = (v: string | null | undefined) =>
    v ? [{ plain_text: v }] : [];
  return {
    title: {
      id: "title",
      type: "title",
      title: [{ plain_text: over?.title ?? "testアクションA" }],
    },
    ext: {
      id: "ext",
      type: "rich_text",
      rich_text: rich(over?.externalId ?? EXTERNAL),
    },
    cust: {
      id: "cust",
      type: "relation",
      relation: [{ id: CUSTOMER }],
      has_more: false,
    },
    deal: { id: "deal", type: "relation", relation: [], has_more: false },
    act: { id: "act", type: "relation", relation: [], has_more: false },
    staff: { id: "staff", type: "relation", relation: [], has_more: false },
    due: {
      id: "due",
      type: "date",
      date: { start: over?.dueDate ?? "2026-08-10" },
    },
    status: {
      id: "status",
      type: "relation",
      relation: [{ id: over?.statusPageId ?? STATUS_OPEN }],
      has_more: false,
    },
    prio: { id: "prio", type: "relation", relation: [], has_more: false },
    doneAt: {
      id: "doneAt",
      type: "date",
      date: over?.completedAt ? { start: over.completedAt } : null,
    },
    cbid: { id: "cbid", type: "rich_text", rich_text: rich("actor") },
    cbname: { id: "cbname", type: "rich_text", rich_text: rich("Actor") },
  };
}

function applyWriteToProps(
  props: MockProps,
  write: ActionWriteInput,
  externalId: string,
) {
  props.title!.title = [{ plain_text: write.title }];
  props.ext!.rich_text = [{ plain_text: externalId }];
  props.cust!.relation = [{ id: write.customerPageId }];
  props.deal!.relation = write.dealPageId ? [{ id: write.dealPageId }] : [];
  props.act!.relation = write.activityPageId
    ? [{ id: write.activityPageId }]
    : [];
  props.staff!.relation = write.staffPageId
    ? [{ id: write.staffPageId }]
    : [];
  props.due!.date = { start: write.dueDate };
  props.status!.relation = [{ id: write.statusPageId }];
  props.prio!.relation = write.priorityPageId
    ? [{ id: write.priorityPageId }]
    : [];
  props.doneAt!.date = write.completedAt
    ? { start: write.completedAt }
    : null;
}

function createMockDeps(over?: {
  ops?: Map<string, WriteOperationRow>;
  pagesByExternalId?: Map<string, string>;
  statusSemantic?: (id: string) => string | null;
}) {
  const ops = over?.ops ?? new Map<string, WriteOperationRow>();
  const pagesByExternalId =
    over?.pagesByExternalId ?? new Map<string, string>();
  const pages = new Map<
    string,
    {
      id: string;
      last_edited_time: string;
      properties: MockProps;
      in_trash?: boolean;
    }
  >();
  const resolveSemantic =
    over?.statusSemantic ??
    ((id: string) =>
      id === STATUS_DONE ? "done" : id === STATUS_OPEN ? "open" : null);

  const notion = {
    dataSources: {
      query: vi.fn(
        async ({ filter }: { filter: { rich_text: { equals: string } } }) => {
          const ext = filter.rich_text.equals;
          const id = pagesByExternalId.get(ext);
          return { results: id ? [{ id }] : [] };
        },
      ),
    },
    pages: {
      create: vi.fn(async () => {
        const id = `page-${pages.size + 1}`;
        const props = emptyProps();
        pages.set(id, {
          id,
          last_edited_time: "2026-08-06T00:00:00.000Z",
          properties: props,
        });
        pagesByExternalId.set(EXTERNAL, id);
        return { id };
      }),
      retrieve: vi.fn(async ({ page_id }: { page_id: string }) => {
        const page = pages.get(page_id);
        if (!page) throw new NotionHttpError(404, "not_found", "r1");
        return {
          id: page.id,
          in_trash: page.in_trash ?? false,
          last_edited_time: page.last_edited_time,
          properties: page.properties,
        };
      }),
      update: vi.fn(async ({ page_id }: { page_id: string }) => {
        const page = pages.get(page_id);
        if (!page) throw new NotionHttpError(404, "not_found", "r1");
        page.last_edited_time = "2026-08-06T01:00:00.000Z";
        return { id: page_id };
      }),
      properties: {
        retrieve: vi.fn(async () => ({
          type: "relation",
          relation: [],
          has_more: false,
        })),
      },
    },
  };

  const deps: ActionWriteDeps = {
    notion: notion as never,
    actionsDataSourceId: "ds-actions",
    propertiesByName: propsByName,
    writeOps: {
      async getByRequestId(id) {
        return ops.get(id) ?? null;
      },
      async insertPending(row) {
        ops.set(row.requestId, {
          request_id: row.requestId,
          entity_type: "action",
          operation: row.operation,
          external_id: row.externalId,
          input_hash: row.inputHash,
          status: "pending",
          notion_page_id: row.notionPageId ?? null,
          recovery_payload:
            row.recoveryPayload as WriteOperationRow["recovery_payload"],
          actor_id: row.actorId,
          started_at: new Date().toISOString(),
          completed_at: null,
          error: null,
        });
      },
      async markNotionDone(input) {
        const row = ops.get(input.requestId)!;
        row.status = "notion_done";
        row.notion_page_id = input.notionPageId;
        if (input.recoveryPayload !== undefined) {
          row.recovery_payload =
            input.recoveryPayload as WriteOperationRow["recovery_payload"];
        }
      },
      async markCompleted(id) {
        const row = ops.get(id)!;
        row.status = "completed";
        row.completed_at = new Date().toISOString();
      },
      async markFailed(id, error) {
        const row = ops.get(id)!;
        row.status = "failed";
        row.error = error;
      },
    },
    index: {
      upsert: vi.fn(async () => undefined),
      resolveAssigneeUserId: vi.fn(async () => null),
      resolveStatusSemantic: vi.fn(async (id: string) => resolveSemantic(id)),
      getCustomerDisplayName: vi.fn().mockResolvedValue("test_customer"),
      getDealTitle: vi.fn(async () => null),
      getStaffName: vi.fn(async () => null),
    },
    audit: { insert: vi.fn(async () => undefined) },
    syncErrors: { insert: vi.fn(async () => undefined) },
    nextActionRecalc: {
      requestForTargets: vi.fn(async () => undefined),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  return { deps, ops, pages, pagesByExternalId, notion };
}

describe("action write pipeline", () => {
  it("create: pending→notion_done→completed", async () => {
    const { deps, ops } = createMockDeps();
    const requestId = "22222222-2222-4222-8222-222222222222";
    const result = await executeActionCreate(deps, {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId: EXTERNAL,
      input: sampleInput(),
    });
    expect(result.status).toBe("completed");
    expect(ops.get(requestId)?.status).toBe("completed");
    expect(deps.nextActionRecalc.requestForTargets).toHaveBeenCalled();
  });

  it("同じrequest_idは冪等", async () => {
    const { deps, notion } = createMockDeps();
    const requestId = "33333333-3333-4333-8333-333333333333";
    const cmd = {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId: EXTERNAL,
      input: sampleInput(),
    };
    await executeActionCreate(deps, cmd);
    await executeActionCreate(deps, cmd);
    expect(notion.pages.create).toHaveBeenCalledTimes(1);
  });

  it("同じrequest_id+異なる入力は拒否", async () => {
    const { deps } = createMockDeps();
    const requestId = "44444444-4444-4444-8444-444444444444";
    await executeActionCreate(deps, {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId: EXTERNAL,
      input: sampleInput(),
    });
    await expect(
      executeActionCreate(deps, {
        requestId,
        actorId: "actor",
        actorName: "Actor",
        externalId: EXTERNAL,
        input: sampleInput({ title: "別" }),
      }),
    ).rejects.toMatchObject({ code: "input_hash_mismatch" });
  });

  it("更新の楽観ロック競合を拒否", async () => {
    const { deps, pages } = createMockDeps();
    pages.set("page-u", {
      id: "page-u",
      last_edited_time: "2026-08-06T12:00:00.000Z",
      properties: emptyProps(),
    });
    await expect(
      executeActionUpdate(deps, {
        requestId: "77777777-7777-4777-8777-777777777777",
        actorId: "actor",
        actorName: "Actor",
        notionPageId: "page-u",
        externalId: EXTERNAL,
        expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
        input: sampleInput({ title: "更新後" }),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("更新成功", async () => {
    const { deps, pages } = createMockDeps();
    pages.set("page-u2", {
      id: "page-u2",
      last_edited_time: "2026-08-06T00:00:00.000Z",
      properties: emptyProps(),
    });
    const result = await executeActionUpdate(deps, {
      requestId: "88888888-8888-4888-8888-888888888888",
      actorId: "actor",
      actorName: "Actor",
      notionPageId: "page-u2",
      externalId: EXTERNAL,
      expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
      input: sampleInput({ title: "更新後アクション", dueDate: "2026-08-20" }),
    });
    expect(result.status).toBe("completed");
  });

  it("完了状態へ更新するとcompletedAtが空なら今日を埋める", async () => {
    const { deps, pages, notion } = createMockDeps();
    pages.set("page-done", {
      id: "page-done",
      last_edited_time: "2026-08-06T00:00:00.000Z",
      properties: emptyProps(),
    });
    let writtenCompletedAt: string | null | undefined;
    notion.pages.update.mockImplementationOnce(
      async (args: { page_id: string; properties?: Record<string, unknown> }) => {
        const { page_id, properties = {} } = args;
        const page = pages.get(page_id)!;
        const doneProp = properties.doneAt as
          | { date: { start: string } | null }
          | undefined;
        writtenCompletedAt = doneProp?.date?.start ?? null;
        if (doneProp) {
          page.properties.doneAt!.date = doneProp.date;
        }
        page.properties.status!.relation = [{ id: STATUS_DONE }];
        page.last_edited_time = "2026-08-06T01:00:00.000Z";
        return { id: page_id };
      },
    );
    await executeActionUpdate(deps, {
      requestId: "99999999-9999-4999-8999-999999999999",
      actorId: "actor",
      actorName: "Actor",
      notionPageId: "page-done",
      externalId: EXTERNAL,
      expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
      input: sampleInput({
        statusPageId: STATUS_DONE,
        completedAt: null,
      }),
    });
    expect(writtenCompletedAt).toBe(todayDateTokyo());
  });

  it("notion_doneから再開できる", async () => {
    const requestId = "55555555-5555-4555-8555-555555555555";
    const input = sampleInput();
    const { deps, ops, pages, pagesByExternalId } = createMockDeps();
    pages.set("page-x", {
      id: "page-x",
      last_edited_time: "2026-08-06T00:00:00.000Z",
      properties: emptyProps(),
    });
    pagesByExternalId.set(EXTERNAL, "page-x");
    ops.set(requestId, {
      request_id: requestId,
      entity_type: "action",
      operation: "create",
      external_id: EXTERNAL,
      input_hash: hashActionWriteInput(input),
      status: "notion_done",
      notion_page_id: "page-x",
      recovery_payload: null,
      actor_id: "actor",
      started_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    });
    const result = await executeActionCreate(deps, {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId: EXTERNAL,
      input,
    });
    expect(result.status).toBe("completed");
    expect(deps.notion.pages.create).not.toHaveBeenCalled();
  });

  it("曖昧失敗後にexternal_id照合で復旧", async () => {
    const { deps, pages, pagesByExternalId, notion } = createMockDeps();
    notion.pages.create.mockImplementationOnce(async () => {
      pages.set("page-amb", {
        id: "page-amb",
        last_edited_time: "2026-08-06T00:00:00.000Z",
        properties: emptyProps(),
      });
      pagesByExternalId.set(EXTERNAL, "page-amb");
      throw new NotionHttpError(503, "write_ambiguous_failure", "r-amb");
    });
    const result = await executeActionCreate(deps, {
      requestId: "66666666-6666-4666-8666-666666666666",
      actorId: "actor",
      actorName: "Actor",
      externalId: EXTERNAL,
      input: sampleInput(),
    });
    expect(result.status).toBe("completed");
    expect(result.notionPageId).toBe("page-amb");
  });

  it("曖昧更新: content_hash一致で復旧", async () => {
    const { deps, pages, notion } = createMockDeps();
    const write = sampleInput({ title: "曖昧復旧後", dueDate: "2026-09-01" });
    pages.set("page-amb-u", {
      id: "page-amb-u",
      last_edited_time: "2026-08-06T00:00:00.000Z",
      properties: emptyProps(),
    });
    notion.pages.update.mockImplementationOnce(
      async ({ page_id }: { page_id: string }) => {
        const page = pages.get(page_id)!;
        applyWriteToProps(page.properties, write, EXTERNAL);
        page.last_edited_time = "2026-08-06T01:00:00.000Z";
        throw new NotionHttpError(503, "write_ambiguous_failure", "r-amb-u");
      },
    );
    const result = await executeActionUpdate(deps, {
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actorId: "actor",
      actorName: "Actor",
      notionPageId: "page-amb-u",
      externalId: EXTERNAL,
      expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
      input: write,
    });
    expect(result.status).toBe("completed");
  });

  it("曖昧更新: content_hash不一致は拒否", async () => {
    const { deps, pages, notion } = createMockDeps();
    pages.set("page-amb-m", {
      id: "page-amb-m",
      last_edited_time: "2026-08-06T00:00:00.000Z",
      properties: emptyProps(),
    });
    notion.pages.update.mockImplementationOnce(async () => {
      throw new NotionHttpError(503, "write_ambiguous_failure", "r-amb-m");
    });
    await expect(
      executeActionUpdate(deps, {
        requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        actorId: "actor",
        actorName: "Actor",
        notionPageId: "page-amb-m",
        externalId: EXTERNAL,
        expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
        input: sampleInput({ title: "不一致更新" }),
      }),
    ).rejects.toMatchObject({ code: "ambiguous_write" });
  });
});
