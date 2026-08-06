import { createHash } from "node:crypto";

import type { ContactWriteInput } from "@/lib/contacts/types";
import {
  collapseWhitespace,
  emptyToNull,
  normalizeEmailOrNull,
  normalizeKanaForSearch,
  normalizePhone,
  toHalfWidthAscii,
} from "@/lib/normalize";

/**
 * input_hash用に正規化した正規形。
 * 表示原文そのものではなく、照合に使う正規化値でハッシュする。
 */
export function canonicalizeContactWriteInput(
  input: ContactWriteInput,
): Record<string, unknown> {
  return {
    name: collapseWhitespace(toHalfWidthAscii(input.name)),
    nameKana: input.nameKana
      ? normalizeKanaForSearch(input.nameKana)
      : null,
    customerPageId: input.customerPageId,
    department: emptyToNull(
      input.department
        ? collapseWhitespace(toHalfWidthAscii(input.department))
        : null,
    ),
    title: emptyToNull(
      input.title ? collapseWhitespace(toHalfWidthAscii(input.title)) : null,
    ),
    phone: normalizePhone(input.phone),
    email: normalizeEmailOrNull(input.email),
    contactTypePageId: input.contactTypePageId,
    note: emptyToNull(
      input.note ? collapseWhitespace(toHalfWidthAscii(input.note)) : null,
    ),
    isActive: input.isActive,
  };
}

export function hashContactWriteInput(input: ContactWriteInput): string {
  const canonical = canonicalizeContactWriteInput(input);
  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

/**
 * 表示用原文のサニタイズ(Notion保存値)。
 * 検索用正規化値とは分離する。
 */
export function sanitizeContactWriteInput(
  input: ContactWriteInput,
): ContactWriteInput {
  const name = emptyToNull(input.name);
  if (!name) {
    throw new Error("氏名は必須です");
  }
  const customerPageId = emptyToNull(input.customerPageId);
  if (!customerPageId) {
    throw new Error("所属アカウントは必須です");
  }

  const textField = (v: string | null | undefined): string | null => {
    const t = emptyToNull(v);
    return t ? collapseWhitespace(t) : null;
  };

  return {
    name: collapseWhitespace(name),
    nameKana: emptyToNull(input.nameKana),
    customerPageId,
    department: textField(input.department),
    title: textField(input.title),
    phone: emptyToNull(input.phone),
    email: emptyToNull(input.email),
    contactTypePageId: input.contactTypePageId,
    note: textField(input.note),
    isActive: input.isActive !== false,
  };
}
