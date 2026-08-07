import { describe, expect, it, vi } from "vitest";

import type { ActivityWriteInput, WriteOperationRow } from "@/lib/activities/types";
import { hashActivityWriteInput } from "@/lib/activities/input-hash";
import {
  executeActivityCreate,
  executeActivityUpdate,
  type ActivityWriteDeps,
} from "@/lib/sync/activity-write-pipeline-core";
import { NotionHttpError } from "@/lib/notion/client-core";
import {
  ACTIVITY_BODY_END_MARKER,
  ACTIVITY_BODY_HEADING,
  formatActivityBodyVersionMarker,
  type NotionBlockLike,
} from "@/lib/notion/converters/page-body";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const EXTERNAL = "11111111-1111-4111-8111-111111111111";
const CAT = "11111111-1111-4111-8111-000000000401";

const propsByName = {
  タイトル: { id: "title", type: "title" },
  external_id: { id: "ext", type: "rich_text" },
  顧客アカウント: { id: "cust", type: "relation" },
  関連案件: { id: "deal", type: "relation" },
  顧客担当者: { id: "contacts", type: "relation" },
  対応日時: { id: "at", type: "date" },
  対応分類: { id: "cats", type: "relation" },
  要約: { id: "summary", type: "rich_text" },
  "次回アクション(入力記録)": { id: "nan", type: "rich_text" },
  "次回予定日(入力記録)": { id: "nad", type: "date" },
  登録者ID: { id: "cbid", type: "rich_text" },
  登録者名: { id: "cbname", type: "rich_text" },
  最終編集者ID: { id: "ubid", type: "rich_text" },
  最終編集者名: { id: "ubname", type: "rich_text" },
  batch_id: { id: "batch", type: "rich_text" },
};

function sampleInput(over: Partial<ActivityWriteInput> = {}): ActivityWriteInput {
  return {
    title: "test対応A",
    customerPageId: CUSTOMER,
    dealPageId: null,
    contactPageIds: [],
    activityAt: "2026-08-07T10:00:00.000Z",
    categoryPageIds: [CAT],
    summary: "要約A",
    nextActionNote: null,
    nextActionDate: null,
    body: "本文A",
    batchId: null,
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
  summary?: string | null;
  activityAt?: string;
  bodyActor?: boolean;
}): MockProps {
  const rich = (v: string | null | undefined) =>
    v ? [{ plain_text: v }] : [];
  return {
    title: {
      id: "title",
      type: "title",
      title: [{ plain_text: over?.title ?? "test対応A" }],
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
    contacts: {
      id: "contacts",
      type: "relation",
      relation: [],
      has_more: false,
    },
    at: {
      id: "at",
      type: "date",
      date: { start: over?.activityAt ?? "2026-08-07T10:00:00.000Z" },
    },
    cats: {
      id: "cats",
      type: "relation",
      relation: [{ id: CAT }],
      has_more: false,
    },
    summary: {
      id: "summary",
      type: "rich_text",
      rich_text: rich(over?.summary === undefined ? "要約A" : over.summary),
    },
    nan: { id: "nan", type: "rich_text", rich_text: [] },
    nad: { id: "nad", type: "date", date: null },
    cbid: { id: "cbid", type: "rich_text", rich_text: rich("actor") },
    cbname: { id: "cbname", type: "rich_text", rich_text: rich("Actor") },
    ubid: { id: "ubid", type: "rich_text", rich_text: rich("actor") },
    ubname: { id: "ubname", type: "rich_text", rich_text: rich("Actor") },
    batch: { id: "batch", type: "rich_text", rich_text: [] },
  };
}

function bodyBlocks(body: string, version: number): NotionBlockLike[] {
  return [
    {
      id: `m-${version}`,
      type: "paragraph",
      paragraph: {
        rich_text: [{ plain_text: formatActivityBodyVersionMarker(version) }],
      },
    },
    {
      id: `h-${version}`,
      type: "heading_2",
      heading_2: { rich_text: [{ plain_text: ACTIVITY_BODY_HEADING }] },
    },
    {
      id: `b-${version}`,
      type: "paragraph",
      paragraph: { rich_text: [{ plain_text: body }] },
    },
    {
      id: `e-${version}`,
      type: "paragraph",
      paragraph: { rich_text: [{ plain_text: ACTIVITY_BODY_END_MARKER }] },
    },
  ];
}

function applyWriteToProps(
  props: MockProps,
  write: ActivityWriteInput,
  externalId: string,
) {
  props.title!.title = [{ plain_text: write.title }];
  props.ext!.rich_text = [{ plain_text: externalId }];
  props.cust!.relation = [{ id: write.customerPageId }];
  props.deal!.relation = write.dealPageId ? [{ id: write.dealPageId }] : [];
  props.contacts!.relation = write.contactPageIds.map((id) => ({ id }));
  props.at!.date = { start: write.activityAt };
  props.cats!.relation = write.categoryPageIds.map((id) => ({ id }));
  props.summary!.rich_text = write.summary
    ? [{ plain_text: write.summary }]
    : [];
  props.nan!.rich_text = write.nextActionNote
    ? [{ plain_text: write.nextActionNote }]
    : [];
  props.nad!.date = write.nextActionDate
    ? { start: write.nextActionDate }
    : null;
  props.ubid!.rich_text = [{ plain_text: "actor" }];
  props.ubname!.rich_text = [{ plain_text: "Actor" }];
  props.batch!.rich_text = write.batchId
    ? [{ plain_text: write.batchId }]
    : [];
}

function createMockDeps(over?: {
  ops?: Map<string, WriteOperationRow>;
  pagesByExternalId?: Map<string, string>;
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
      blocks: NotionBlockLike[];
      in_trash?: boolean;
    }
  >();
  let blockSeq = 1;

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
      create: vi.fn(
        async ({
          children,
        }: {
          children?: Array<Record<string, unknown>>;
        }) => {
          const id = `page-${pages.size + 1}`;
          const props = emptyProps();
          const blocks: NotionBlockLike[] = [];
          for (const child of children ?? []) {
            const type = child.type as string;
            const bid = `blk-${blockSeq++}`;
            if (type === "paragraph") {
              const text =
                (
                  child.paragraph as {
                    rich_text?: Array<{ text?: { content?: string } }>;
                  }
                )?.rich_text?.[0]?.text?.content ?? "";
              blocks.push({
                id: bid,
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: text }] },
              });
            } else if (type === "heading_2") {
              const text =
                (
                  child.heading_2 as {
                    rich_text?: Array<{ text?: { content?: string } }>;
                  }
                )?.rich_text?.[0]?.text?.content ?? "";
              blocks.push({
                id: bid,
                type: "heading_2",
                heading_2: { rich_text: [{ plain_text: text }] },
              });
            }
          }
          pages.set(id, {
            id,
            last_edited_time: "2026-08-06T00:00:00.000Z",
            properties: props,
            blocks,
          });
          pagesByExternalId.set(EXTERNAL, id);
          return { id };
        },
      ),
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
    blocks: {
      children: {
        list: vi.fn(async ({ block_id }: { block_id: string }) => {
          const page = pages.get(block_id);
          return {
            results: page?.blocks ?? [],
            has_more: false,
            next_cursor: null,
          };
        }),
        append: vi.fn(
          async ({
            block_id,
            children,
          }: {
            block_id: string;
            children: Array<Record<string, unknown>>;
          }) => {
            const page = pages.get(block_id)!;
            const created: NotionBlockLike[] = [];
            for (const child of children) {
              const type = child.type as string;
              const bid = `blk-${blockSeq++}`;
              let block: NotionBlockLike;
              if (type === "heading_2") {
                const text =
                  (
                    child.heading_2 as {
                      rich_text?: Array<{ text?: { content?: string } }>;
                    }
                  )?.rich_text?.[0]?.text?.content ?? "";
                block = {
                  id: bid,
                  type: "heading_2",
                  heading_2: { rich_text: [{ plain_text: text }] },
                };
              } else {
                const text =
                  (
                    child.paragraph as {
                      rich_text?: Array<{ text?: { content?: string } }>;
                    }
                  )?.rich_text?.[0]?.text?.content ?? "";
                block = {
                  id: bid,
                  type: "paragraph",
                  paragraph: { rich_text: [{ plain_text: text }] },
                };
              }
              page.blocks.push(block);
              created.push(block);
            }
            return { results: created };
          },
        ),
      },
      delete: vi.fn(async ({ block_id }: { block_id: string }) => {
        for (const page of pages.values()) {
          page.blocks = page.blocks.filter((b) => b.id !== block_id);
        }
      }),
    },
  };

  const deps: ActivityWriteDeps = {
    notion: notion as never,
    activitiesDataSourceId: "ds-activities",
    propertiesByName: propsByName,
    writeOps: {
      async getByRequestId(id) {
        return ops.get(id) ?? null;
      },
      async insertPending(row) {
        ops.set(row.requestId, {
          request_id: row.requestId,
          entity_type: "activity",
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
      getCustomerDisplayName: vi.fn().mockResolvedValue("test_customer"),
      getContactNames: vi.fn(async () => []),
      getDealTitle: vi.fn(async () => null),
      getCategoryNames: vi.fn(async () => ["電話"]),
    },
    audit: { insert: vi.fn(async () => undefined) },
    syncErrors: { insert: vi.fn(async () => undefined) },
    latestActivityRecalc: {
      requestForCustomers: vi.fn(async () => undefined),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  return { deps, ops, pages, pagesByExternalId, notion };
}

describe("activity write pipeline", () => {
  it("create: pending→notion_done→completed", async () => {
    const { deps, ops } = createMockDeps();
    const requestId = "22222222-2222-4222-8222-222222222222";
    const result = await executeActivityCreate(deps, {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId: EXTERNAL,
      input: sampleInput(),
    });
    expect(result.status).toBe("completed");
    expect(result.notionPageId).toBeTruthy();
    expect(ops.get(requestId)?.status).toBe("completed");
    expect(deps.audit.insert).toHaveBeenCalled();
    expect(deps.index.upsert).toHaveBeenCalled();
    expect(deps.latestActivityRecalc.requestForCustomers).toHaveBeenCalled();
  });

  it("同じrequest_idは冪等(重複作成しない)", async () => {
    const { deps, notion } = createMockDeps();
    const requestId = "33333333-3333-4333-8333-333333333333";
    const cmd = {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId: EXTERNAL,
      input: sampleInput(),
    };
    const first = await executeActivityCreate(deps, cmd);
    const second = await executeActivityCreate(deps, cmd);
    expect(second.status).toBe("completed");
    expect(second.notionPageId).toBe(first.notionPageId);
    expect(notion.pages.create).toHaveBeenCalledTimes(1);
  });

  it("同じrequest_id+異なる入力は拒否", async () => {
    const { deps } = createMockDeps();
    const requestId = "44444444-4444-4444-8444-444444444444";
    await executeActivityCreate(deps, {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId: EXTERNAL,
      input: sampleInput(),
    });
    await expect(
      executeActivityCreate(deps, {
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
      blocks: bodyBlocks("本文A", 1),
    });
    await expect(
      executeActivityUpdate(deps, {
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

  it("更新成功(本文含む)", async () => {
    const { deps, pages, notion } = createMockDeps();
    pages.set("page-u2", {
      id: "page-u2",
      last_edited_time: "2026-08-06T00:00:00.000Z",
      properties: emptyProps(),
      blocks: bodyBlocks("本文A", 1),
    });
    notion.pages.update.mockImplementationOnce(
      async (args: { page_id: string; properties?: Record<string, unknown> }) => {
        const { page_id, properties = {} } = args;
        const page = pages.get(page_id)!;
        if (properties.title) {
          const t = properties.title as {
            title: Array<{ text: { content: string } }>;
          };
          page.properties.title!.title = [
            { plain_text: t.title[0]?.text.content ?? "" },
          ];
        }
        page.last_edited_time = "2026-08-06T01:00:00.000Z";
        return { id: page_id };
      },
    );
    const result = await executeActivityUpdate(deps, {
      requestId: "88888888-8888-4888-8888-888888888888",
      actorId: "actor",
      actorName: "Actor",
      notionPageId: "page-u2",
      externalId: EXTERNAL,
      expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
      input: sampleInput({ title: "更新後対応", body: "本文B" }),
    });
    expect(result.status).toBe("completed");
    expect(deps.notion.pages.update).toHaveBeenCalled();
    expect(notion.blocks.children.append).toHaveBeenCalled();
  });

  it("notion_doneから監査・indexを再開できる", async () => {
    const requestId = "55555555-5555-4555-8555-555555555555";
    const input = sampleInput();
    const { deps, ops, pages, pagesByExternalId } = createMockDeps();
    pages.set("page-x", {
      id: "page-x",
      last_edited_time: "2026-08-06T00:00:00.000Z",
      properties: emptyProps(),
      blocks: bodyBlocks("本文A", 1),
    });
    pagesByExternalId.set(EXTERNAL, "page-x");
    ops.set(requestId, {
      request_id: requestId,
      entity_type: "activity",
      operation: "create",
      external_id: EXTERNAL,
      input_hash: hashActivityWriteInput(input),
      status: "notion_done",
      notion_page_id: "page-x",
      recovery_payload: null,
      actor_id: "actor",
      started_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    });
    const result = await executeActivityCreate(deps, {
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
        blocks: bodyBlocks("本文A", 1),
      });
      pagesByExternalId.set(EXTERNAL, "page-amb");
      throw new NotionHttpError(503, "write_ambiguous_failure", "r-amb");
    });
    const result = await executeActivityCreate(deps, {
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
    const write = sampleInput({ title: "曖昧復旧後" });
    pages.set("page-amb-u", {
      id: "page-amb-u",
      last_edited_time: "2026-08-06T00:00:00.000Z",
      properties: emptyProps(),
      blocks: bodyBlocks("本文A", 1),
    });
    notion.pages.update.mockImplementationOnce(
      async ({ page_id }: { page_id: string }) => {
        const page = pages.get(page_id)!;
        applyWriteToProps(page.properties, write, EXTERNAL);
        page.last_edited_time = "2026-08-06T01:00:00.000Z";
        throw new NotionHttpError(503, "write_ambiguous_failure", "r-amb-u");
      },
    );
    const result = await executeActivityUpdate(deps, {
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
      blocks: bodyBlocks("本文A", 1),
    });
    notion.pages.update.mockImplementationOnce(async () => {
      throw new NotionHttpError(503, "write_ambiguous_failure", "r-amb-m");
    });
    await expect(
      executeActivityUpdate(deps, {
        requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        actorId: "actor",
        actorName: "Actor",
        notionPageId: "page-amb-m",
        externalId: EXTERNAL,
        expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
        input: sampleInput({ title: "不一致更新" }),
      }),
    ).rejects.toMatchObject({ code: "ambiguous_write" });
    expect(deps.syncErrors.insert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "ambiguous_update" }),
    );
  });
});
