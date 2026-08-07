import { describe, expect, it, vi } from "vitest";

import type { ContractWriteInput, WriteOperationRow } from "@/lib/contracts/types";
import { hashContractWriteInput } from "@/lib/contracts/input-hash";
import {
  executeContractCreate,
  executeContractUpdate,
  type ContractWriteDeps,
} from "@/lib/sync/contract-write-pipeline-core";
import { NotionHttpError } from "@/lib/notion/client-core";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const EXTERNAL = "11111111-1111-4111-8111-111111111111";
const STATUS = "11111111-1111-4111-8111-000000000601";
const PAYMENT = "11111111-1111-4111-8111-000000000651";

const propsByName = {
  契約名: { id: "title", type: "title" },
  external_id: { id: "ext", type: "rich_text" },
  顧客アカウント: { id: "cust", type: "relation" },
  関連案件: { id: "deal", type: "relation" },
  契約区分: { id: "ctype", type: "relation" },
  取引区分: { id: "trade", type: "relation" },
  支払状況: { id: "pay", type: "relation" },
  状態: { id: "status", type: "relation" },
  担当者: { id: "staff", type: "relation" },
  契約金額: { id: "amount", type: "number" },
  契約日: { id: "contracted", type: "date" },
  契約開始日: { id: "start", type: "date" },
  契約終了日: { id: "end", type: "date" },
  自動更新: { id: "renew", type: "checkbox" },
  請求条件: { id: "billing", type: "rich_text" },
  契約書URL: { id: "url", type: "url" },
  契約書ファイル: { id: "files", type: "files" },
  備考: { id: "note", type: "rich_text" },
};

function sampleInput(over: Partial<ContractWriteInput> = {}): ContractWriteInput {
  return {
    title: "test契約A",
    customerPageId: CUSTOMER,
    dealPageId: null,
    contractTypePageId: null,
    tradeTypePageId: null,
    paymentStatusPageId: PAYMENT,
    statusPageId: STATUS,
    staffPageIds: [],
    amount: 10000,
    contractedAt: "2026-08-01",
    startDate: "2026-08-01",
    endDate: "2027-07-31",
    autoRenew: false,
    billingTerms: null,
    contractUrl: null,
    note: null,
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
    number?: number | null;
    date?: { start: string } | null;
    checkbox?: boolean;
    url?: string | null;
    files?: unknown[];
  }
>;

function emptyProps(over?: {
  title?: string;
  externalId?: string;
  amount?: number | null;
  statusPageId?: string | null;
  paymentStatusPageId?: string | null;
}): MockProps {
  const rich = (v: string | null | undefined) =>
    v ? [{ plain_text: v }] : [];
  return {
    title: {
      id: "title",
      type: "title",
      title: [{ plain_text: over?.title ?? "test契約A" }],
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
    ctype: { id: "ctype", type: "relation", relation: [], has_more: false },
    trade: { id: "trade", type: "relation", relation: [], has_more: false },
    pay: {
      id: "pay",
      type: "relation",
      relation:
        over?.paymentStatusPageId === null
          ? []
          : [{ id: over?.paymentStatusPageId ?? PAYMENT }],
      has_more: false,
    },
    status: {
      id: "status",
      type: "relation",
      relation:
        over?.statusPageId === null
          ? []
          : [{ id: over?.statusPageId ?? STATUS }],
      has_more: false,
    },
    staff: { id: "staff", type: "relation", relation: [], has_more: false },
    amount: {
      id: "amount",
      type: "number",
      number: over?.amount === undefined ? 10000 : over.amount,
    },
    contracted: {
      id: "contracted",
      type: "date",
      date: { start: "2026-08-01" },
    },
    start: { id: "start", type: "date", date: { start: "2026-08-01" } },
    end: { id: "end", type: "date", date: { start: "2027-07-31" } },
    renew: { id: "renew", type: "checkbox", checkbox: false },
    billing: { id: "billing", type: "rich_text", rich_text: [] },
    url: { id: "url", type: "url", url: null },
    files: { id: "files", type: "files", files: [] },
    note: { id: "note", type: "rich_text", rich_text: [] },
  };
}

function applyWriteToProps(
  props: MockProps,
  write: ContractWriteInput,
  externalId: string,
) {
  props.title!.title = [{ plain_text: write.title }];
  props.ext!.rich_text = [{ plain_text: externalId }];
  props.cust!.relation = [{ id: write.customerPageId }];
  props.deal!.relation = write.dealPageId ? [{ id: write.dealPageId }] : [];
  props.ctype!.relation = write.contractTypePageId
    ? [{ id: write.contractTypePageId }]
    : [];
  props.trade!.relation = write.tradeTypePageId
    ? [{ id: write.tradeTypePageId }]
    : [];
  props.pay!.relation = write.paymentStatusPageId
    ? [{ id: write.paymentStatusPageId }]
    : [];
  props.status!.relation = write.statusPageId
    ? [{ id: write.statusPageId }]
    : [];
  props.staff!.relation = write.staffPageIds.map((id) => ({ id }));
  props.amount!.number = write.amount;
  props.contracted!.date = write.contractedAt
    ? { start: write.contractedAt }
    : null;
  props.start!.date = write.startDate ? { start: write.startDate } : null;
  props.end!.date = write.endDate ? { start: write.endDate } : null;
  props.renew!.checkbox = write.autoRenew;
  props.billing!.rich_text = write.billingTerms
    ? [{ plain_text: write.billingTerms }]
    : [];
  props.url!.url = write.contractUrl;
  props.note!.rich_text = write.note ? [{ plain_text: write.note }] : [];
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
      in_trash?: boolean;
    }
  >();

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

  const deps: ContractWriteDeps = {
    notion: notion as never,
    contractsDataSourceId: "ds-contracts",
    propertiesByName: propsByName,
    writeOps: {
      async getByRequestId(id) {
        return ops.get(id) ?? null;
      },
      async insertPending(row) {
        ops.set(row.requestId, {
          request_id: row.requestId,
          entity_type: "contract",
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
      resolveStaffUserIds: vi.fn(async () => []),
      resolveStatusSemantic: vi.fn(async () => "active"),
      getCustomerDisplayName: vi.fn().mockResolvedValue("test_customer"),
      getDealTitle: vi.fn(async () => null),
      getStaffNames: vi.fn(async () => []),
    },
    audit: { insert: vi.fn(async () => undefined) },
    syncErrors: { insert: vi.fn(async () => undefined) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  return { deps, ops, pages, pagesByExternalId, notion };
}

describe("contract write pipeline", () => {
  it("create: pending→notion_done→completed", async () => {
    const { deps, ops } = createMockDeps();
    const requestId = "22222222-2222-4222-8222-222222222222";
    const result = await executeContractCreate(deps, {
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
    const first = await executeContractCreate(deps, cmd);
    const second = await executeContractCreate(deps, cmd);
    expect(second.status).toBe("completed");
    expect(second.notionPageId).toBe(first.notionPageId);
    expect(notion.pages.create).toHaveBeenCalledTimes(1);
  });

  it("同じrequest_id+異なる入力は拒否", async () => {
    const { deps } = createMockDeps();
    const requestId = "44444444-4444-4444-8444-444444444444";
    await executeContractCreate(deps, {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId: EXTERNAL,
      input: sampleInput(),
    });
    await expect(
      executeContractCreate(deps, {
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
      executeContractUpdate(deps, {
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
    const { deps, pages, notion } = createMockDeps();
    pages.set("page-u2", {
      id: "page-u2",
      last_edited_time: "2026-08-06T00:00:00.000Z",
      properties: emptyProps(),
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
    const result = await executeContractUpdate(deps, {
      requestId: "88888888-8888-4888-8888-888888888888",
      actorId: "actor",
      actorName: "Actor",
      notionPageId: "page-u2",
      externalId: EXTERNAL,
      expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
      input: sampleInput({ title: "更新後契約", amount: 20000 }),
    });
    expect(result.status).toBe("completed");
    expect(deps.notion.pages.update).toHaveBeenCalled();
  });

  it("notion_doneから監査・indexを再開できる", async () => {
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
      entity_type: "contract",
      operation: "create",
      external_id: EXTERNAL,
      input_hash: hashContractWriteInput(input),
      status: "notion_done",
      notion_page_id: "page-x",
      recovery_payload: null,
      actor_id: "actor",
      started_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    });
    const result = await executeContractCreate(deps, {
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
    const result = await executeContractCreate(deps, {
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
    });
    notion.pages.update.mockImplementationOnce(
      async ({ page_id }: { page_id: string }) => {
        const page = pages.get(page_id)!;
        applyWriteToProps(page.properties, write, EXTERNAL);
        page.last_edited_time = "2026-08-06T01:00:00.000Z";
        throw new NotionHttpError(503, "write_ambiguous_failure", "r-amb-u");
      },
    );
    const result = await executeContractUpdate(deps, {
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
      executeContractUpdate(deps, {
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
