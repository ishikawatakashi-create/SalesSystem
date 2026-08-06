import { describe, expect, it, vi } from "vitest";

import type { ContactWriteInput, WriteOperationRow } from "@/lib/contacts/types";
import { hashContactWriteInput } from "@/lib/contacts/input-hash";
import {
  executeContactCreate,
  executeContactUpdate,
  type ContactWriteDeps,
} from "@/lib/sync/contact-write-pipeline-core";
import { NotionHttpError } from "@/lib/notion/client-core";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const EXTERNAL = "11111111-1111-4111-8111-111111111111";

const propsByName = {
  氏名: { id: "title", type: "title" },
  external_id: { id: "ext", type: "rich_text" },
  氏名よみ: { id: "kana", type: "rich_text" },
  所属アカウント: { id: "cust", type: "relation" },
  部署: { id: "dept", type: "rich_text" },
  役職: { id: "role", type: "rich_text" },
  電話番号: { id: "phone", type: "phone_number" },
  メールアドレス: { id: "mail", type: "email" },
  区分: { id: "ctype", type: "relation" },
  備考: { id: "note", type: "rich_text" },
  有効: { id: "active", type: "checkbox" },
};

function sampleInput(over: Partial<ContactWriteInput> = {}): ContactWriteInput {
  return {
    name: "test担当A",
    nameKana: "てすとたんとうえー",
    customerPageId: CUSTOMER,
    department: null,
    title: null,
    phone: "03-0000-0001",
    email: "test@example.com",
    contactTypePageId: null,
    note: null,
    isActive: true,
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
  kana: {
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
  dept: {
    id: string;
    type: string;
    rich_text: Array<{ plain_text: string }>;
  };
  role: {
    id: string;
    type: string;
    rich_text: Array<{ plain_text: string }>;
  };
  phone: { id: string; type: string; phone_number: string | null };
  mail: { id: string; type: string; email: string | null };
  ctype: {
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
  active: { id: string; type: string; checkbox: boolean };
};

function emptyProps(over?: {
  name?: string;
  externalId?: string;
  customerPageId?: string;
  phone?: string | null;
  email?: string | null;
  isActive?: boolean;
}): MockPageProps {
  return {
    title: {
      id: "title",
      type: "title",
      title: [{ plain_text: over?.name ?? "test担当A" }],
    },
    ext: {
      id: "ext",
      type: "rich_text",
      rich_text: [{ plain_text: over?.externalId ?? EXTERNAL }],
    },
    kana: {
      id: "kana",
      type: "rich_text",
      rich_text: [{ plain_text: "てすとたんとうえー" }],
    },
    cust: {
      id: "cust",
      type: "relation",
      relation: [{ id: over?.customerPageId ?? CUSTOMER }],
      has_more: false,
    },
    dept: { id: "dept", type: "rich_text", rich_text: [] },
    role: { id: "role", type: "rich_text", rich_text: [] },
    phone: {
      id: "phone",
      type: "phone_number",
      phone_number: over?.phone ?? "03-0000-0001",
    },
    mail: {
      id: "mail",
      type: "email",
      email: over?.email ?? "test@example.com",
    },
    ctype: {
      id: "ctype",
      type: "relation",
      relation: [],
      has_more: false,
    },
    note: { id: "note", type: "rich_text", rich_text: [] },
    active: {
      id: "active",
      type: "checkbox",
      checkbox: over?.isActive ?? true,
    },
  };
}

function applyWriteToProps(
  props: MockPageProps,
  write: ContactWriteInput,
  externalId: string,
) {
  props.title.title = [{ plain_text: write.name }];
  props.ext.rich_text = [{ plain_text: externalId }];
  props.kana.rich_text = write.nameKana
    ? [{ plain_text: write.nameKana }]
    : [];
  props.cust.relation = [{ id: write.customerPageId }];
  props.dept.rich_text = write.department
    ? [{ plain_text: write.department }]
    : [];
  props.role.rich_text = write.title ? [{ plain_text: write.title }] : [];
  props.phone.phone_number = write.phone;
  props.mail.email = write.email;
  props.ctype.relation = write.contactTypePageId
    ? [{ id: write.contactTypePageId }]
    : [];
  props.note.rich_text = write.note ? [{ plain_text: write.note }] : [];
  props.active.checkbox = write.isActive;
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
        const ext =
          props.ext.rich_text[0]?.plain_text ?? EXTERNAL;
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

  const deps: ContactWriteDeps = {
    notion: notion as never,
    contactsDataSourceId: "ds-contacts",
    propertiesByName: propsByName,
    writeOps: {
      async getByRequestId(id) {
        return ops.get(id) ?? null;
      },
      async insertPending(row) {
        ops.set(row.requestId, {
          request_id: row.requestId,
          entity_type: "contact",
          operation: row.operation,
          external_id: row.externalId,
          input_hash: row.inputHash,
          status: "pending",
          notion_page_id: row.notionPageId ?? null,
          recovery_payload: row.recoveryPayload as WriteOperationRow["recovery_payload"],
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
    },
    audit: {
      insert: vi.fn(async () => undefined),
    },
    syncErrors: {
      insert: vi.fn(async () => undefined),
    },
    customerSearch: {
      refreshForCustomer: vi.fn(async () => undefined),
      getDisplayName: vi.fn().mockResolvedValue("test_customer"),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };

  return { deps, ops, pages, pagesByExternalId, notion };
}

describe("contact write pipeline", () => {
  it("create: pending→notion_done→completed", async () => {
    const { deps, ops } = createMockDeps();
    const requestId = "22222222-2222-4222-8222-222222222222";
    const result = await executeContactCreate(deps, {
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
    expect(deps.customerSearch.refreshForCustomer).toHaveBeenCalled();
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
    const first = await executeContactCreate(deps, cmd);
    const second = await executeContactCreate(deps, cmd);
    expect(second.status).toBe("completed");
    expect(second.notionPageId).toBe(first.notionPageId);
    expect(notion.pages.create).toHaveBeenCalledTimes(1);
  });

  it("同じrequest_id+異なる入力は拒否", async () => {
    const { deps } = createMockDeps();
    const requestId = "44444444-4444-4444-8444-444444444444";
    await executeContactCreate(deps, {
      requestId,
      actorId: "actor",
      actorName: "Actor",
      externalId: EXTERNAL,
      input: sampleInput(),
    });
    await expect(
      executeContactCreate(deps, {
        requestId,
        actorId: "actor",
        actorName: "Actor",
        externalId: EXTERNAL,
        input: sampleInput({ name: "別" }),
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
      executeContactUpdate(deps, {
        requestId: "77777777-7777-4777-8777-777777777777",
        actorId: "actor",
        actorName: "Actor",
        notionPageId: "page-u",
        externalId: EXTERNAL,
        expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
        input: sampleInput({ name: "更新後" }),
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
    const result = await executeContactUpdate(deps, {
      requestId: "88888888-8888-4888-8888-888888888888",
      actorId: "actor",
      actorName: "Actor",
      notionPageId: "page-u2",
      externalId: EXTERNAL,
      expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
      input: sampleInput({ name: "更新後名称", isActive: false }),
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
      entity_type: "contact",
      operation: "create",
      external_id: EXTERNAL,
      input_hash: hashContactWriteInput(input),
      status: "notion_done",
      notion_page_id: "page-x",
      recovery_payload: null,
      actor_id: "actor",
      started_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    });

    const result = await executeContactCreate(deps, {
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

    const result = await executeContactCreate(deps, {
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
    const write = sampleInput({ name: "曖昧復旧後", phone: "03-9999-0000" });
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

    const result = await executeContactUpdate(deps, {
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
      executeContactUpdate(deps, {
        requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        actorId: "actor",
        actorName: "Actor",
        notionPageId: "page-amb-m",
        externalId: EXTERNAL,
        expectedLastEditedTime: "2026-08-06T00:00:00.000Z",
        input: sampleInput({ name: "不一致更新" }),
      }),
    ).rejects.toMatchObject({ code: "ambiguous_write" });
    expect(deps.syncErrors.insert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "ambiguous_update" }),
    );
  });
});
