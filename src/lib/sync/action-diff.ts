import type { ActionDomain } from "@/lib/notion/converters/action";
import type { ActionWriteInput } from "@/lib/actions/types";
import {
  actionToNotionProperties,
  type PropertyIdMap,
} from "@/lib/notion/converters/action";

export function writeInputToActionDomainFields(input: {
  externalId: string;
  write: ActionWriteInput;
  createdById: string | null;
  createdByName: string | null;
}): Omit<ActionDomain, "notionPageId" | "inTrash"> {
  return {
    externalId: input.externalId,
    title: input.write.title,
    customerPageId: input.write.customerPageId,
    dealPageId: input.write.dealPageId,
    activityPageId: input.write.activityPageId,
    staffPageId: input.write.staffPageId,
    dueDate: input.write.dueDate,
    statusPageId: input.write.statusPageId,
    priorityPageId: input.write.priorityPageId,
    completedAt: input.write.completedAt,
    createdById: input.createdById,
    createdByName: input.createdByName,
  };
}

export function buildActionPropertyDiff(input: {
  before: ActionDomain;
  write: ActionWriteInput;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  const afterDomain = writeInputToActionDomainFields({
    externalId: input.before.externalId,
    write: input.write,
    createdById: input.before.createdById,
    createdByName: input.before.createdByName,
  });

  const beforeProps = actionToNotionProperties({
    action: {
      externalId: input.before.externalId,
      title: input.before.title,
      customerPageId: input.before.customerPageId,
      dealPageId: input.before.dealPageId,
      activityPageId: input.before.activityPageId,
      staffPageId: input.before.staffPageId,
      dueDate: input.before.dueDate,
      statusPageId: input.before.statusPageId,
      priorityPageId: input.before.priorityPageId,
      completedAt: input.before.completedAt,
      createdById: input.before.createdById,
      createdByName: input.before.createdByName,
    },
    propertiesByName: input.propertiesByName,
  });

  const afterProps = actionToNotionProperties({
    action: afterDomain,
    propertiesByName: input.propertiesByName,
  });

  // 作成者は更新で上書きしない
  const skipNames = ["作成者ID", "作成者名"] as const;
  const skipIds = new Set(
    skipNames
      .map((n) => input.propertiesByName[n]?.id)
      .filter((id): id is string => Boolean(id)),
  );

  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(afterProps)) {
    if (skipIds.has(key)) continue;
    const before = beforeProps[key];
    if (JSON.stringify(before) !== JSON.stringify(value)) {
      diff[key] = value;
    }
  }
  return diff;
}

export function buildActionChangedFieldsAudit(input: {
  before: ActionDomain;
  write: ActionWriteInput;
}): Record<string, { before: unknown; after: unknown }> {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  const pairs: Array<[string, unknown, unknown]> = [
    ["アクション内容", input.before.title, input.write.title],
    ["顧客アカウント", input.before.customerPageId, input.write.customerPageId],
    ["案件", input.before.dealPageId, input.write.dealPageId],
    ["元対応履歴", input.before.activityPageId, input.write.activityPageId],
    ["自社担当者", input.before.staffPageId, input.write.staffPageId],
    ["期限", input.before.dueDate, input.write.dueDate],
    ["状態", input.before.statusPageId, input.write.statusPageId],
    ["優先度", input.before.priorityPageId, input.write.priorityPageId],
    ["完了日時", input.before.completedAt, input.write.completedAt],
  ];
  for (const [field, before, after] of pairs) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed[field] = { before, after };
    }
  }
  return changed;
}
