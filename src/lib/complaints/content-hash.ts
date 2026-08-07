import { createHash } from "node:crypto";

import type { ComplaintDomain } from "@/lib/notion/converters/complaint";
import type { ComplaintWriteInput } from "@/lib/complaints/types";
import { hashComplaintBody } from "@/lib/notion/converters/page-body";

/**
 * 楽観ロック・復旧比較用の content_hash。
 * 本文は全文ではなく bodyHash(SHA-256 of concatenated sections)を含める。
 */
export function hashComplaintDomain(
  complaint: Omit<ComplaintDomain, "notionPageId" | "inTrash" | "managedBlockIds">,
): string {
  const payload = {
    externalId: complaint.externalId,
    title: complaint.title,
    customerPageId: complaint.customerPageId,
    dealPageId: complaint.dealPageId,
    severityPageId: complaint.severityPageId,
    statusPageId: complaint.statusPageId,
    staffPageId: complaint.staffPageId,
    occurredOn: complaint.occurredOn,
    summary: complaint.summary,
    dueDate: complaint.dueDate,
    completedOn: complaint.completedOn,
    note: complaint.note,
    bodyHash:
      complaint.bodyHash ||
      hashComplaintBody({
        content: complaint.content,
        cause: complaint.cause,
        response: complaint.response,
        prevention: complaint.prevention,
      }),
    bodyVersion: complaint.bodyVersion,
  };
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

export function hashComplaintWriteWithExternalId(input: {
  externalId: string;
  write: ComplaintWriteInput;
  bodyVersion: number | null;
}): string {
  const bodyHash = hashComplaintBody({
    content: input.write.content,
    cause: input.write.cause,
    response: input.write.response,
    prevention: input.write.prevention,
  });
  return hashComplaintDomain({
    externalId: input.externalId,
    title: input.write.title,
    customerPageId: input.write.customerPageId,
    dealPageId: input.write.dealPageId,
    severityPageId: input.write.severityPageId,
    statusPageId: input.write.statusPageId,
    staffPageId: input.write.staffPageId,
    occurredOn: input.write.occurredOn,
    summary: input.write.summary,
    dueDate: input.write.dueDate,
    completedOn: input.write.completedOn,
    note: input.write.note,
    content: input.write.content,
    cause: input.write.cause,
    response: input.write.response,
    prevention: input.write.prevention,
    bodyVersion: input.bodyVersion,
    bodyHash,
  });
}
