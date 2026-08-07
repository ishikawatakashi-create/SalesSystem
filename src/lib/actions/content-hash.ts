import { createHash } from "node:crypto";

import type { ActionDomain } from "@/lib/notion/converters/action";
import type { ActionWriteInput } from "@/lib/actions/types";

/**
 * 楽観ロック・復旧比較用の content_hash。
 */
export function hashActionDomain(
  action: Omit<ActionDomain, "notionPageId" | "inTrash">,
): string {
  const payload = {
    externalId: action.externalId,
    title: action.title,
    customerPageId: action.customerPageId,
    dealPageId: action.dealPageId,
    activityPageId: action.activityPageId,
    staffPageId: action.staffPageId,
    dueDate: action.dueDate,
    statusPageId: action.statusPageId,
    priorityPageId: action.priorityPageId,
    completedAt: action.completedAt,
    createdById: action.createdById,
    createdByName: action.createdByName,
  };
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

export function hashActionWriteWithExternalId(input: {
  externalId: string;
  write: ActionWriteInput;
  createdById: string | null;
  createdByName: string | null;
}): string {
  return hashActionDomain({
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
  });
}
