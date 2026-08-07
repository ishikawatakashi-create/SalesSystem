import { createHash } from "node:crypto";

import type { ActivityWriteInput } from "@/lib/activities/types";
import { summarizeText } from "@/lib/notion/converters/page-body";
import {
  collapseWhitespace,
  emptyToNull,
  toHalfWidthAscii,
} from "@/lib/normalize";

function sorted(ids: string[]) {
  return [...ids].sort();
}

export function canonicalizeActivityWriteInput(
  input: ActivityWriteInput,
): Record<string, unknown> {
  return {
    title: collapseWhitespace(toHalfWidthAscii(input.title)),
    customerPageId: input.customerPageId,
    dealPageId: input.dealPageId,
    contactPageIds: sorted(input.contactPageIds),
    activityAt: input.activityAt,
    categoryPageIds: sorted(input.categoryPageIds),
    summary: emptyToNull(
      input.summary
        ? collapseWhitespace(toHalfWidthAscii(input.summary))
        : null,
    ),
    nextActionNote: emptyToNull(
      input.nextActionNote
        ? collapseWhitespace(toHalfWidthAscii(input.nextActionNote))
        : null,
    ),
    nextActionDate: input.nextActionDate,
    body: input.body,
    batchId: input.batchId,
  };
}

export function hashActivityWriteInput(input: ActivityWriteInput): string {
  const canonical = canonicalizeActivityWriteInput(input);
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

/**
 * 表示用原文のサニタイズ(Notion保存値)。
 * summary が空なら本文先頭200字を自動設定。
 */
export function sanitizeActivityWriteInput(
  input: ActivityWriteInput,
): ActivityWriteInput {
  const title = emptyToNull(input.title);
  if (!title) {
    throw new Error("タイトルは必須です");
  }
  const customerPageId = emptyToNull(input.customerPageId);
  if (!customerPageId) {
    throw new Error("顧客アカウントは必須です");
  }
  const activityAt = emptyToNull(input.activityAt);
  if (!activityAt) {
    throw new Error("対応日時は必須です");
  }

  const textField = (v: string | null | undefined): string | null => {
    const t = emptyToNull(v);
    return t ? collapseWhitespace(t) : null;
  };

  const body = input.body ?? "";
  let summary = textField(input.summary);
  if (!summary) {
    const auto = summarizeText(body, 200);
    summary = auto || null;
  }

  return {
    title: collapseWhitespace(title),
    customerPageId,
    dealPageId: emptyToNull(input.dealPageId),
    contactPageIds: [...input.contactPageIds],
    activityAt,
    categoryPageIds: [...input.categoryPageIds],
    summary,
    nextActionNote: textField(input.nextActionNote),
    nextActionDate: emptyToNull(input.nextActionDate),
    body,
    batchId: emptyToNull(input.batchId),
  };
}
