import type { ComplaintDomain } from "@/lib/notion/converters/complaint";
import type { ComplaintWriteInput } from "@/lib/complaints/types";
import {
  complaintToNotionProperties,
  type PropertyIdMap,
} from "@/lib/notion/converters/complaint";
import { hashComplaintBody } from "@/lib/notion/converters/page-body";

export function writeInputToComplaintDomainFields(input: {
  externalId: string;
  write: ComplaintWriteInput;
  bodyVersion: number | null;
}): Omit<ComplaintDomain, "notionPageId" | "inTrash" | "managedBlockIds"> {
  const bodyHash = hashComplaintBody({
    content: input.write.content,
    cause: input.write.cause,
    response: input.write.response,
    prevention: input.write.prevention,
  });
  return {
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
  };
}

export function buildComplaintPropertyDiff(input: {
  before: ComplaintDomain;
  write: ComplaintWriteInput;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  const afterDomain = writeInputToComplaintDomainFields({
    externalId: input.before.externalId,
    write: input.write,
    bodyVersion: input.before.bodyVersion,
  });

  const beforeProps = complaintToNotionProperties({
    complaint: {
      externalId: input.before.externalId,
      title: input.before.title,
      customerPageId: input.before.customerPageId,
      dealPageId: input.before.dealPageId,
      severityPageId: input.before.severityPageId,
      statusPageId: input.before.statusPageId,
      staffPageId: input.before.staffPageId,
      occurredOn: input.before.occurredOn,
      summary: input.before.summary,
      dueDate: input.before.dueDate,
      completedOn: input.before.completedOn,
      note: input.before.note,
    },
    propertiesByName: input.propertiesByName,
  });

  const afterProps = complaintToNotionProperties({
    complaint: afterDomain,
    propertiesByName: input.propertiesByName,
  });

  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(afterProps)) {
    const before = beforeProps[key];
    if (JSON.stringify(before) !== JSON.stringify(value)) {
      diff[key] = value;
    }
  }
  return diff;
}

export function buildComplaintChangedFieldsAudit(input: {
  before: ComplaintDomain;
  write: ComplaintWriteInput;
}): Record<string, { before: unknown; after: unknown }> {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  const pairs: Array<[string, unknown, unknown]> = [
    ["タイトル", input.before.title, input.write.title],
    ["顧客アカウント", input.before.customerPageId, input.write.customerPageId],
    ["関連案件", input.before.dealPageId, input.write.dealPageId],
    ["重要度", input.before.severityPageId, input.write.severityPageId],
    ["対応状況", input.before.statusPageId, input.write.statusPageId],
    ["対応責任者", input.before.staffPageId, input.write.staffPageId],
    ["発生日", input.before.occurredOn, input.write.occurredOn],
    ["概要", input.before.summary, input.write.summary],
    ["対応期限", input.before.dueDate, input.write.dueDate],
    ["完了日", input.before.completedOn, input.write.completedOn],
    ["備考", input.before.note, input.write.note],
    ["内容", input.before.content, input.write.content],
    ["原因", input.before.cause, input.write.cause],
    ["対応内容", input.before.response, input.write.response],
    ["再発防止策", input.before.prevention, input.write.prevention],
  ];
  for (const [field, before, after] of pairs) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed[field] = { before, after };
    }
  }
  return changed;
}
