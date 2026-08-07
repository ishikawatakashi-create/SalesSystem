import { createHash } from "node:crypto";

import type { ComplaintWriteInput } from "@/lib/complaints/types";
import {
  concatenateComplaintBodySections,
  summarizeText,
} from "@/lib/notion/converters/page-body";
import {
  collapseWhitespace,
  emptyToNull,
  toHalfWidthAscii,
} from "@/lib/normalize";

function nullBody(v: string | null | undefined): string | null {
  const t = emptyToNull(v);
  return t ?? null;
}

export function canonicalizeComplaintWriteInput(
  input: ComplaintWriteInput,
): Record<string, unknown> {
  return {
    title: collapseWhitespace(toHalfWidthAscii(input.title)),
    customerPageId: input.customerPageId,
    dealPageId: input.dealPageId,
    severityPageId: input.severityPageId,
    statusPageId: input.statusPageId,
    staffPageId: input.staffPageId,
    occurredOn: input.occurredOn,
    summary: emptyToNull(
      input.summary
        ? collapseWhitespace(toHalfWidthAscii(input.summary))
        : null,
    ),
    dueDate: input.dueDate,
    completedOn: input.completedOn,
    note: emptyToNull(
      input.note ? collapseWhitespace(toHalfWidthAscii(input.note)) : null,
    ),
    content: input.content,
    cause: input.cause,
    response: input.response,
    prevention: input.prevention,
  };
}

export function hashComplaintWriteInput(input: ComplaintWriteInput): string {
  const canonical = canonicalizeComplaintWriteInput(input);
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

/**
 * 表示用原文のサニタイズ(Notion保存値)。
 * summary が空なら本文連結の先頭200字を自動設定。
 */
export function sanitizeComplaintWriteInput(
  input: ComplaintWriteInput,
): ComplaintWriteInput {
  const title = emptyToNull(input.title);
  if (!title) {
    throw new Error("タイトルは必須です");
  }
  const customerPageId = emptyToNull(input.customerPageId);
  if (!customerPageId) {
    throw new Error("顧客アカウントは必須です");
  }

  const textField = (v: string | null | undefined): string | null => {
    const t = emptyToNull(v);
    return t ? collapseWhitespace(t) : null;
  };

  const content = nullBody(input.content);
  const cause = nullBody(input.cause);
  const response = nullBody(input.response);
  const prevention = nullBody(input.prevention);

  let summary = textField(input.summary);
  if (!summary) {
    const auto = summarizeText(
      concatenateComplaintBodySections({
        content,
        cause,
        response,
        prevention,
      }),
      200,
    );
    summary = auto || null;
  }

  return {
    title: collapseWhitespace(title),
    customerPageId,
    dealPageId: emptyToNull(input.dealPageId),
    severityPageId: input.severityPageId,
    statusPageId: input.statusPageId,
    staffPageId: input.staffPageId,
    occurredOn: emptyToNull(input.occurredOn),
    summary,
    dueDate: emptyToNull(input.dueDate),
    completedOn: emptyToNull(input.completedOn),
    note: textField(input.note),
    content,
    cause,
    response,
    prevention,
  };
}
