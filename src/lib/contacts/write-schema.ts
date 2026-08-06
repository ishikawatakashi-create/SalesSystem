import { z } from "zod";

import { ContactSyncError } from "@/lib/sync/errors";
import {
  collectContactRelationIds,
  loadContactRelationLookup,
  validateContactRelations,
  type ContactRelationLooseInput,
  type ContactRelationValidationContext,
} from "@/lib/contacts/validate-relations";
import type { ContactWriteInput } from "@/lib/contacts/types";

/**
 * 先方担当者書込のZodスキーマ(クライアントフォームとServer Action共用)。
 * 単一relation欄は配列も受理し、relation検証で0/1件へ正規化する。
 */

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pageId = z.string().regex(PAGE_ID_RE, "IDの形式が不正です");

const optionalText = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((v) => {
      const t = typeof v === "string" ? v.trim() : v;
      return t ? t : null;
    });

const singleRelation = z
  .union([pageId, z.array(pageId).max(10), z.null()])
  .optional()
  .transform((v) => (v === undefined ? null : v));

const requiredSingleRelation = z
  .union([pageId, z.array(pageId).max(10)])
  .transform((v) => v);

export const contactWriteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "氏名は必須です")
    .max(200, "氏名が長すぎます"),
  nameKana: optionalText(200),
  customerPageId: requiredSingleRelation,
  department: optionalText(200),
  title: optionalText(200),
  phone: optionalText(50),
  email: optionalText(254).refine(
    (v) => v === null || /^\S+@\S+\.\S+$/.test(v),
    "メールアドレスの形式が不正です",
  ),
  contactTypePageId: singleRelation,
  note: optionalText(2000),
  isActive: z.boolean().optional().default(true),
});

export type ContactWriteFormValues = z.input<typeof contactWriteSchema>;

/**
 * Zod検証 + relation一括検証。
 * write_operations作成・Notion API呼出より前に必ず通すこと。
 * 失敗時は ContactSyncError("validation") を投げる(入力本文をメッセージに含めない)。
 */
export async function prepareContactWrite(input: {
  data: unknown;
  db: { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  context?: ContactRelationValidationContext;
}): Promise<ContactWriteInput> {
  const parsed = contactWriteSchema.safeParse(input.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join(".") ?? "";
    throw new ContactSyncError(
      "validation",
      first?.message ?? "入力内容に誤りがあります",
      { reason: "schema", field },
    );
  }
  const loose = parsed.data as ContactRelationLooseInput;
  const ids = collectContactRelationIds(loose);
  const lookup = await loadContactRelationLookup(input.db, ids);
  return validateContactRelations({
    write: loose,
    lookup,
    context: input.context,
  });
}
