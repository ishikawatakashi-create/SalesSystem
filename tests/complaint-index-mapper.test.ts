import { describe, expect, it } from "vitest";

import { complaintDomainToIndexRow } from "@/lib/complaints/index-mapper";
import type { ComplaintDomain } from "@/lib/notion/converters/complaint";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const STATUS = "11111111-1111-4111-8111-000000000801";
const SEV = "11111111-1111-4111-8111-000000000701";

function sampleComplaint(over: Partial<ComplaintDomain> = {}): ComplaintDomain {
  return {
    notionPageId: "page-complaint-1",
    externalId: "11111111-1111-4111-8111-111111111111",
    inTrash: false,
    title: "クレームマッパー",
    customerPageId: CUSTOMER,
    dealPageId: null,
    severityPageId: SEV,
    statusPageId: STATUS,
    staffPageId: null,
    occurredOn: "2026-08-01",
    summary: "概要テキスト",
    dueDate: "2026-08-20",
    completedOn: null,
    note: null,
    content: "内容",
    cause: null,
    response: null,
    prevention: null,
    bodyVersion: 1,
    bodyHash: "bodyhash",
    managedBlockIds: ["b1"],
    ...over,
  };
}

describe("complaintDomainToIndexRow", () => {
  it("status_semantic と body_hash・search_text を写像する", () => {
    const row = complaintDomainToIndexRow({
      complaint: sampleComplaint(),
      assigneeUserId: "user-1",
      statusSemantic: "open",
      contentHash: "abc",
      notionLastEditedAt: "2026-08-07T00:00:00.000Z",
      syncStatus: "synced",
      customerDisplayName: "テスト顧客",
      dealTitle: "案件X",
      staffName: "担当A",
      nowIso: "2026-08-07T01:00:00.000Z",
    });
    expect(row.notion_page_id).toBe("page-complaint-1");
    expect(row.status_semantic).toBe("open");
    expect(row.body_hash).toBe("bodyhash");
    expect(row.assignee_user_id).toBe("user-1");
    expect(row.severity_id).toBe(SEV);
    expect(row.search_text).toContain("クレームマッパー".replace(/\s/g, ""));
    expect(row.sync_status).toBe("synced");
  });

  it("done semantic と null 担当を保持する", () => {
    const row = complaintDomainToIndexRow({
      complaint: sampleComplaint({
        statusPageId: null,
        severityPageId: null,
        completedOn: "2026-08-07",
      }),
      assigneeUserId: null,
      statusSemantic: "done",
      contentHash: "def",
      notionLastEditedAt: null,
      syncStatus: "synced",
    });
    expect(row.status_semantic).toBe("done");
    expect(row.status_id).toBeNull();
    expect(row.assignee_user_id).toBeNull();
    expect(row.completed_on).toBe("2026-08-07");
  });
});
