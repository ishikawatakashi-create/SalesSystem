import { describe, expect, it, vi } from "vitest";

import type { CustomerWriteInput, WriteOperationRow } from "@/lib/customers/types";
import { hashCustomerWriteInput } from "@/lib/customers/input-hash";
import {
  executeCustomerCreate,
  executeCustomerUpdate,
  type CustomerWriteDeps,
} from "@/lib/sync/write-pipeline-core";
import { CustomerSyncError } from "@/lib/sync/errors";
import { classifyNotionError } from "@/lib/sync/notion-errors";
import { NotionHttpError } from "@/lib/notion/client-core";
import { customerDomainToIndexRow } from "@/lib/customers/index-mapper";
import type { CustomerDomain } from "@/lib/notion/converters/customer";
import { hashCustomerDomain } from "@/lib/customers/content-hash";

const propsByName = {
  表示名: { id: "title", type: "title" },
  external_id: { id: "ext", type: "rich_text" },
  法人名: { id: "legal", type: "rich_text" },
  事業所名: { id: "office", type: "rich_text" },
  郵便番号: { id: "zip", type: "rich_text" },
  都道府県: { id: "pref", type: "select" },
  市区町村: { id: "city", type: "rich_text" },
  住所以降: { id: "addr", type: "rich_text" },
  電話番号: { id: "phone", type: "phone_number" },
  メールアドレス: { id: "mail", type: "email" },
  代表者名: { id: "rep", type: "rich_text" },
  Webサイト: { id: "web", type: "url" },
  事業区分: { id: "cat", type: "relation" },
  タグ: { id: "tag", type: "relation" },
  営業ステータス: { id: "st", type: "relation" },
  集客ルート: { id: "route", type: "relation" },
  優先度: { id: "pri", type: "relation" },
  自社担当者: { id: "staff", type: "relation" },
  関連アカウント: { id: "rel", type: "relation" },
  最新対応内容: { id: "act", type: "rich_text" },
  最終対応日: { id: "lad", type: "date" },
  次回アクション: { id: "na", type: "rich_text" },
  次回予定日: { id: "nad", type: "date" },
  見込み金額: { id: "amt", type: "number" },
  アーカイブ: { id: "arch", type: "checkbox" },
};

function sampleInput(over: Partial<CustomerWriteInput> = {}): CustomerWriteInput {
  return {
    displayName: "test顧客A",
    legalName: "株式会社テスト",
    officeName: null,
    postalCode: "100-0001",
    prefecture: "東京都",
    city: "千代田区",
    addressLine: null,
    phone: "03-0000-0001",
    email: "test@example.com",
    representativeName: null,
    website: null,
    businessCategoryPageIds: [],
    tagPageIds: [],
    salesStatusPageId: null,
    acquisitionRoutePageId: null,
    priorityPageId: null,
    staffPageIds: [],
    relatedAccountPageIds: [],
    expectedAmount: null,
    isArchived: false,
    ...over,
  };
}

function emptyProps() {
  return {
    title: { id: "title", type: "title", title: [{ plain_text: "test顧客A" }] },
    ext: {
      id: "ext",
      type: "rich_text",
      rich_text: [{ plain_text: "11111111-1111-4111-8111-111111111111" }],
    },
    legal: { id: "legal", type: "rich_text", rich_text: [] },
    office: { id: "office", type: "rich_text", rich_text: [] },
    zip: { id: "zip", type: "rich_text", rich_text: [] },
    pref: { id: "pref", type: "select", select: null },
    city: { id: "city", type: "rich_text", rich_text: [] },
    addr: { id: "addr", type: "rich_text", rich_text: [] },
    phone: { id: "phone", type: "phone_number", phone_number: null },
    mail: { id: "mail", type: "email", email: null },
    rep: { id: "rep", type: "rich_text", rich_text: [] },
    web: { id: "web", type: "url", url: null },
    cat: { id: "cat", type: "relation", relation: [], has_more: false },
    tag: { id: "tag", type: "relation", relation: [], has_more: false },
    st: { id: "st", type: "relation", relation: [], has_more: false },
    route: { id: "route", type: "relation", relation: [], has_more: false },
    pri: { id: "pri", type: "relation", relation: [], has_more: false },
    staff: { id: "staff", type: "relation", relation: [], has_more: false },
    rel: { id: "rel", type: "relation", relation: [], has_more: false },
    act: { id: "act", type: "rich_text", rich_text: [] },
    lad: { id: "lad", type: "date", date: null },
    na: { id: "na", type: "rich_text", rich_text: [] },
    nad: { id: "nad", type: "date", date: null },
    amt: { id: "amt", type: "number", number: null },
    arch: { id: "arch", type: "checkbox", checkbox: false },
  };
}

function createMockDeps(over?: {
  ops?: Map<string, WriteOperationRow>;
  pagesByExternalId?: Map<string, string>;
}) {
  const ops = over?.ops ?? new Map<string, WriteOperationRow>();
  const pagesByExternalId =
    over?.pagesByExternalId ?? new Map<string, string>();
  const pages = new Map<string, { id: string; last_edited_time: string; properties: ReturnType<typeof emptyProps>; in_trash?: boolean }>();

  const notion = {
    dataSources: {
      query: vi.fn(async ({ filter }: { filter: { rich_text: { equals: string } } }) => {
        const ext = filter.rich_text.equals;
        const id = pagesByExternalId.get(ext);
        return { results: id ? [{ id }] : [] };
      }),
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
        const ext =
          props.ext.rich_text[0]?.plain_text ??
          "11111111-1111-4111-8111-111111111111";
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

  const deps: CustomerWriteDeps = {
    notion: notion as never,
    customersDataSourceId: "ds-customers",
    propertiesByName: propsByName,
    writeOps: {
      async getByRequestId(id) {
        return ops.get(id) ?? null;
      },
      async insertPending(row) {
        ops.set(row.requestId, {
          request_id: row.requestId,
          entity_type: "customer",
          operation: row.operation,
          external_id: row.externalId,
          input_hash: row.inputHash,
          status: "pending",
          notion_page_id: row.notionPageId ?? null,
          recovery_payload: row.recoveryPayload,
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
          row.recovery_payload = input.recoveryPayload;
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
      replaceRelations: vi.fn(async () => undefined),
      resolveStaffUserIds: vi.fn(async () => []),
    },
    audit: {
      insert: vi.fn(async () => undefined),
    },
    syncErrors: {
      insert: vi.fn(async () => undefined),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };

  return { deps, ops, pages, pagesByExternalId, notion };
}

describe("customer write pipeline", () => {
  it("create: pending→notion_done→completed", async () => {
    const { deps, ops } = createMockDeps();
    const requestId = "22222222-2222-4222-8222-222222222222";
    const result = await executeCustomerCreate(deps, {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId: "11111111-1111-4111-8111-111111111111",
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
      externalId: "11111111-1111-4111-8111-111111111111",
      input: sampleInput(),
    };
    const first = await executeCustomerCreate(deps, cmd);
    const second = await executeCustomerCreate(deps, cmd);
    expect(second.status).toBe("completed");
    expect(second.notionPageId).toBe(first.notionPageId);
    expect(notion.pages.create).toHaveBeenCalledTimes(1);
  });

  it("同じrequest_id+異なる入力は拒否", async () => {
    const { deps } = createMockDeps();
    const requestId = "44444444-4444-4444-8444-444444444444";
    await executeCustomerCreate(deps, {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId: "11111111-1111-4111-8111-111111111111",
      input: sampleInput(),
    });
    await expect(
      executeCustomerCreate(deps, {
        requestId,
        actorId: "actor",
        actorName: "Actor",
        externalId: "11111111-1111-4111-8111-111111111111",
        input: sampleInput({ displayName: "別" }),
      }),
    ).rejects.toMatchObject({ code: "input_hash_mismatch" });
  });

  it("notion_doneから監査・indexを再開できる", async () => {
    const requestId = "55555555-5555-4555-8555-555555555555";
    const externalId = "11111111-1111-4111-8111-111111111111";
    const input = sampleInput();
    const { deps, ops, pages, pagesByExternalId } = createMockDeps();
    pages.set("page-x", {
      id: "page-x",
      last_edited_time: "2026-08-06T00:00:00.000Z",
      properties: emptyProps(),
    });
    pagesByExternalId.set(externalId, "page-x");
    ops.set(requestId, {
      request_id: requestId,
      entity_type: "customer",
      operation: "create",
      external_id: externalId,
      input_hash: hashCustomerWriteInput(input),
      status: "notion_done",
      notion_page_id: "page-x",
      recovery_payload: null,
      actor_id: "actor",
      started_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    });

    const result = await executeCustomerCreate(deps, {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId,
      input,
    });
    expect(result.status).toBe("completed");
    expect(deps.notion.pages.create).not.toHaveBeenCalled();
  });

  it("曖昧失敗後にexternal_id照合で復旧", async () => {
    const { deps, pages, pagesByExternalId, notion } = createMockDeps();
    const externalId = "11111111-1111-4111-8111-111111111111";
    notion.pages.create.mockImplementationOnce(async () => {
      // 作成は成功したが応答喪失を模擬: 先にページを登録してから失敗
      pages.set("page-amb", {
        id: "page-amb",
        last_edited_time: "2026-08-06T00:00:00.000Z",
        properties: emptyProps(),
      });
      pagesByExternalId.set(externalId, "page-amb");
      throw new NotionHttpError(503, "write_ambiguous_failure", "r-amb");
    });

    const result = await executeCustomerCreate(deps, {
      requestId: "66666666-6666-4666-8666-666666666666",
      actorId: "actor",
      actorName: "Actor",
      externalId,
      input: sampleInput(),
    });
    expect(result.status).toBe("completed");
    expect(result.notionPageId).toBe("page-amb");
  });

  it("更新の楽観ロック競合を拒否", async () => {
    const { deps, pages } = createMockDeps();
    const props = emptyProps();
    pages.set("page-u", {
      id: "page-u",
      last_edited_time: "2026-08-06T12:00:00.000Z",
      properties: props,
    });

    await expect(
      executeCustomerUpdate(deps, {
        requestId: "77777777-7777-4777-8777-777777777777",
        actorId: "actor",
        actorName: "Actor",
        notionPageId: "page-u",
        externalId: "11111111-1111-4111-8111-111111111111",
        expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
        input: sampleInput({ displayName: "更新後" }),
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
    const result = await executeCustomerUpdate(deps, {
      requestId: "88888888-8888-4888-8888-888888888888",
      actorId: "actor",
      actorName: "Actor",
      notionPageId: "page-u2",
      externalId: "11111111-1111-4111-8111-111111111111",
      expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
      input: sampleInput({ displayName: "更新後名称", isArchived: true }),
    });
    expect(result.status).toBe("completed");
    expect(deps.notion.pages.update).toHaveBeenCalled();
  });
});

describe("index mapper / content hash / notion errors", () => {
  it("customer_index行へ変換", () => {
    const customer: CustomerDomain = {
      notionPageId: "p1",
      externalId: "11111111-1111-4111-8111-111111111111",
      inTrash: false,
      displayName: "A",
      legalName: null,
      officeName: null,
      postalCode: null,
      prefecture: "東京都",
      city: null,
      addressLine: null,
      phone: "03-1",
      email: "A@B.com",
      representativeName: null,
      website: null,
      businessCategoryPageIds: ["c1"],
      tagPageIds: [],
      salesStatusPageId: null,
      acquisitionRoutePageId: null,
      priorityPageId: null,
      staffPageIds: ["s1"],
      relatedAccountPageIds: ["r1"],
      latestActivitySummary: null,
      lastActivityAt: null,
      nextAction: null,
      nextActionDate: null,
      expectedAmount: null,
      isArchived: false,
    };
    const row = customerDomainToIndexRow({
      customer,
      staffUserIds: ["user-1"],
      contentHash: hashCustomerDomain(customer),
      notionLastEditedAt: "2026-08-06T00:00:00.000Z",
      syncStatus: "synced",
    });
    expect(row.phone).toBe("03-1");
    expect(row.phone_normalized).toBe("031");
    expect(row.email).toBe("a@b.com");
    expect(row.staff_user_ids).toEqual(["user-1"]);
    expect(row.business_category_ids).toEqual(["c1"]);
  });

  it("Notionエラー分類", () => {
    expect(classifyNotionError(new NotionHttpError(429, "x", "r"))).toBe(
      "rate_limited",
    );
    expect(
      classifyNotionError(new NotionHttpError(503, "write_ambiguous_failure", "r")),
    ).toBe("ambiguous_write");
    expect(
      classifyNotionError(new CustomerSyncError("not_found", "missing")),
    ).toBe("not_found");
  });
});
