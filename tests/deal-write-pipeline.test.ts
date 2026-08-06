import { describe, expect, it, vi } from "vitest";

import type { DealWriteInput, WriteOperationRow } from "@/lib/deals/types";
import { hashDealWriteInput } from "@/lib/deals/input-hash";
import {
  executeDealCreate,
  executeDealUpdate,
  type DealWriteDeps,
} from "@/lib/sync/deal-write-pipeline-core";
import { NotionHttpError } from "@/lib/notion/client-core";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const EXTERNAL = "11111111-1111-4111-8111-111111111111";
const STAGE = "11111111-1111-4111-8111-000000000201";
const STATUS = "11111111-1111-4111-8111-000000000301";

const propsByName = {
  案件名: { id: "title", type: "title" },
  external_id: { id: "ext", type: "rich_text" },
  顧客アカウント: { id: "cust", type: "relation" },
  顧客担当者: { id: "contacts", type: "relation" },
  事業区分: { id: "biz", type: "relation" },
  商材: { id: "product", type: "rich_text" },
  営業ステージ: { id: "stage", type: "relation" },
  自社担当者: { id: "staff", type: "relation" },
  見込み金額: { id: "amount", type: "number" },
  契約金額: { id: "contract", type: "number" },
  確度: { id: "prob", type: "number" },
  受注予定日: { id: "close", type: "date" },
  契約日: { id: "contracted", type: "date" },
  契約期間: { id: "period", type: "date" },
  次回アクション: { id: "next", type: "rich_text" },
  次回予定日: { id: "nextdate", type: "date" },
  失注理由: { id: "lost", type: "rich_text" },
  ステータス: { id: "status", type: "relation" },
  備考: { id: "note", type: "rich_text" },
};

function sampleInput(over: Partial<DealWriteInput> = {}): DealWriteInput {
  return {
    title: "test案件A",
    customerPageId: CUSTOMER,
    contactPageIds: [],
    businessCategoryPageId: null,
    productName: null,
    stagePageId: STAGE,
    staffPageIds: [],
    expectedAmount: 10000,
    contractAmount: null,
    probability: 40,
    expectedCloseDate: null,
    contractedAt: null,
    periodStart: null,
    periodEnd: null,
    lostReason: null,
    statusPageId: STATUS,
    note: null,
    ...over,
  };
}

type MockPageProps = {
  title: { id: string; type: string; title: Array<{ plain_text: string }> };
  ext: {
    id: string;
    type: string;
    rich_text: Array<{ plain_text: string }>;
  };
  cust: {
    id: string;
    type: string;
    relation: Array<{ id: string }>;
    has_more: boolean;
  };
  contacts: {
    id: string;
    type: string;
    relation: Array<{ id: string }>;
    has_more: boolean;
  };
  biz: {
    id: string;
    type: string;
    relation: Array<{ id: string }>;
    has_more: boolean;
  };
  product: {
    id: string;
    type: string;
    rich_text: Array<{ plain_text: string }>;
  };
  stage: {
    id: string;
    type: string;
    relation: Array<{ id: string }>;
    has_more: boolean;
  };
  staff: {
    id: string;
    type: string;
    relation: Array<{ id: string }>;
    has_more: boolean;
  };
  amount: { id: string; type: string; number: number | null };
  contract: { id: string; type: string; number: number | null };
  prob: { id: string; type: string; number: number | null };
  close: { id: string; type: string; date: { start: string } | null };
  contracted: { id: string; type: string; date: { start: string } | null };
  period: {
    id: string;
    type: string;
    date: { start: string; end?: string } | null;
  };
  next: {
    id: string;
    type: string;
    rich_text: Array<{ plain_text: string }>;
  };
  nextdate: { id: string; type: string; date: { start: string } | null };
  lost: {
    id: string;
    type: string;
    rich_text: Array<{ plain_text: string }>;
  };
  status: {
    id: string;
    type: string;
    relation: Array<{ id: string }>;
    has_more: boolean;
  };
  note: {
    id: string;
    type: string;
    rich_text: Array<{ plain_text: string }>;
  };
};

function emptyProps(over?: {
  title?: string;
  externalId?: string;
  customerPageId?: string;
  expectedAmount?: number | null;
  statusPageId?: string | null;
  stagePageId?: string | null;
}): MockPageProps {
  return {
    title: {
      id: "title",
      type: "title",
      title: [{ plain_text: over?.title ?? "test案件A" }],
    },
    ext: {
      id: "ext",
      type: "rich_text",
      rich_text: [{ plain_text: over?.externalId ?? EXTERNAL }],
    },
    cust: {
      id: "cust",
      type: "relation",
      relation: [{ id: over?.customerPageId ?? CUSTOMER }],
      has_more: false,
    },
    contacts: { id: "contacts", type: "relation", relation: [], has_more: false },
    biz: { id: "biz", type: "relation", relation: [], has_more: false },
    product: { id: "product", type: "rich_text", rich_text: [] },
    stage: {
      id: "stage",
      type: "relation",
      relation: over?.stagePageId === null ? [] : [{ id: over?.stagePageId ?? STAGE }],
      has_more: false,
    },
    staff: { id: "staff", type: "relation", relation: [], has_more: false },
    amount: {
      id: "amount",
      type: "number",
      number: over?.expectedAmount === undefined ? 10000 : over.expectedAmount,
    },
    contract: { id: "contract", type: "number", number: null },
    prob: { id: "prob", type: "number", number: 40 },
    close: { id: "close", type: "date", date: null },
    contracted: { id: "contracted", type: "date", date: null },
    period: { id: "period", type: "date", date: null },
    next: { id: "next", type: "rich_text", rich_text: [] },
    nextdate: { id: "nextdate", type: "date", date: null },
    lost: { id: "lost", type: "rich_text", rich_text: [] },
    status: {
      id: "status",
      type: "relation",
      relation:
        over?.statusPageId === null
          ? []
          : [{ id: over?.statusPageId ?? STATUS }],
      has_more: false,
    },
    note: { id: "note", type: "rich_text", rich_text: [] },
  };
}

function applyWriteToProps(
  props: MockPageProps,
  write: DealWriteInput,
  externalId: string,
) {
  props.title.title = [{ plain_text: write.title }];
  props.ext.rich_text = [{ plain_text: externalId }];
  props.cust.relation = [{ id: write.customerPageId }];
  props.contacts.relation = write.contactPageIds.map((id) => ({ id }));
  props.biz.relation = write.businessCategoryPageId
    ? [{ id: write.businessCategoryPageId }]
    : [];
  props.product.rich_text = write.productName
    ? [{ plain_text: write.productName }]
    : [];
  props.stage.relation = write.stagePageId
    ? [{ id: write.stagePageId }]
    : [];
  props.staff.relation = write.staffPageIds.map((id) => ({ id }));
  props.amount.number = write.expectedAmount;
  props.contract.number = write.contractAmount;
  props.prob.number = write.probability;
  props.close.date = write.expectedCloseDate
    ? { start: write.expectedCloseDate }
    : null;
  props.contracted.date = write.contractedAt
    ? { start: write.contractedAt }
    : null;
  props.period.date =
    write.periodStart || write.periodEnd
      ? {
          start: write.periodStart ?? write.periodEnd!,
          ...(write.periodEnd ? { end: write.periodEnd } : {}),
        }
      : null;
  props.lost.rich_text = write.lostReason
    ? [{ plain_text: write.lostReason }]
    : [];
  props.status.relation = write.statusPageId
    ? [{ id: write.statusPageId }]
    : [];
  props.note.rich_text = write.note ? [{ plain_text: write.note }] : [];
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
      properties: MockPageProps;
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
        const ext = props.ext.rich_text[0]?.plain_text ?? EXTERNAL;
        pagesByExternalId.set(ext, id);
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

  const deps: DealWriteDeps = {
    notion: notion as never,
    dealsDataSourceId: "ds-deals",
    propertiesByName: propsByName,
    writeOps: {
      async getByRequestId(id) {
        return ops.get(id) ?? null;
      },
      async insertPending(row) {
        ops.set(row.requestId, {
          request_id: row.requestId,
          entity_type: "deal",
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
      getContactNames: vi.fn(async () => []),
      getStaffNames: vi.fn(async () => []),
    },
    audit: {
      insert: vi.fn(async () => undefined),
    },
    syncErrors: {
      insert: vi.fn(async () => undefined),
    },
    expectedAmountRecalc: {
      requestForCustomers: vi.fn(async () => undefined),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };

  return { deps, ops, pages, pagesByExternalId, notion };
}

describe("deal write pipeline", () => {
  it("create: pending→notion_done→completed", async () => {
    const { deps, ops } = createMockDeps();
    const requestId = "22222222-2222-4222-8222-222222222222";
    const result = await executeDealCreate(deps, {
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
    expect(deps.expectedAmountRecalc.requestForCustomers).toHaveBeenCalled();
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
    const first = await executeDealCreate(deps, cmd);
    const second = await executeDealCreate(deps, cmd);
    expect(second.status).toBe("completed");
    expect(second.notionPageId).toBe(first.notionPageId);
    expect(notion.pages.create).toHaveBeenCalledTimes(1);
  });

  it("同じrequest_id+異なる入力は拒否", async () => {
    const { deps } = createMockDeps();
    const requestId = "44444444-4444-4444-8444-444444444444";
    await executeDealCreate(deps, {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId: EXTERNAL,
      input: sampleInput(),
    });
    await expect(
      executeDealCreate(deps, {
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
      executeDealUpdate(deps, {
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
    const result = await executeDealUpdate(deps, {
      requestId: "88888888-8888-4888-8888-888888888888",
      actorId: "actor",
      actorName: "Actor",
      notionPageId: "page-u2",
      externalId: EXTERNAL,
      expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
      input: sampleInput({ title: "更新後案件", expectedAmount: 20000 }),
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
      entity_type: "deal",
      operation: "create",
      external_id: EXTERNAL,
      input_hash: hashDealWriteInput(input),
      status: "notion_done",
      notion_page_id: "page-x",
      recovery_payload: null,
      actor_id: "actor",
      started_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    });

    const result = await executeDealCreate(deps, {
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

    const result = await executeDealCreate(deps, {
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
    const write = sampleInput({ title: "曖昧復旧後", expectedAmount: 9999 });
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

    const result = await executeDealUpdate(deps, {
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actorId: "actor",
      actorName: "Actor",
      notionPageId: "page-amb-u",
      externalId: EXTERNAL,
      expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
      input: write,
    });
    expect(result.status).toBe("completed");
    expect(deps.syncErrors.insert).not.toHaveBeenCalledWith(
      expect.objectContaining({ stage: "ambiguous_update" }),
    );
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
      executeDealUpdate(deps, {
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
