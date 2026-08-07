import { createHash } from "node:crypto";

import type { ActionWriteInput } from "@/lib/actions/types";
import {
  collapseWhitespace,
  emptyToNull,
  toHalfWidthAscii,
} from "@/lib/normalize";

export function canonicalizeActionWriteInput(
  input: ActionWriteInput,
): Record<string, unknown> {
  return {
    title: collapseWhitespace(toHalfWidthAscii(input.title)),
    customerPageId: input.customerPageId,
    dealPageId: input.dealPageId,
    activityPageId: input.activityPageId,
    staffPageId: input.staffPageId,
    dueDate: input.dueDate,
    statusPageId: input.statusPageId,
    priorityPageId: input.priorityPageId,
    completedAt: input.completedAt,
  };
}

export function hashActionWriteInput(input: ActionWriteInput): string {
  const canonical = canonicalizeActionWriteInput(input);
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

export function sanitizeActionWriteInput(
  input: ActionWriteInput,
): ActionWriteInput {
  const title = emptyToNull(input.title);
  if (!title) {
    throw new Error("アクション内容は必須です");
  }
  const customerPageId = emptyToNull(input.customerPageId);
  if (!customerPageId) {
    throw new Error("顧客アカウントは必須です");
  }
  const dueDate = emptyToNull(input.dueDate);
  if (!dueDate) {
    throw new Error("期限は必須です");
  }
  const statusPageId = emptyToNull(input.statusPageId);
  if (!statusPageId) {
    throw new Error("状態は必須です");
  }

  return {
    title: collapseWhitespace(title),
    customerPageId,
    dealPageId: emptyToNull(input.dealPageId),
    activityPageId: emptyToNull(input.activityPageId),
    staffPageId: emptyToNull(input.staffPageId),
    dueDate,
    statusPageId,
    priorityPageId: emptyToNull(input.priorityPageId),
    completedAt: emptyToNull(input.completedAt),
  };
}
