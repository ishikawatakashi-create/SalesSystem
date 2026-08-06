import { z } from "zod";

import { CustomerSyncError } from "@/lib/sync/errors";
import {
  collectCustomerRelationIds,
  loadCustomerRelationLookup,
  validateCustomerRelations,
  type CustomerRelationLooseInput,
  type RelationValidationContext,
} from "@/lib/customers/validate-relations";
import type { CustomerWriteInput } from "@/lib/customers/types";

/**
 * 顧客書込のZodスキーマ(クライアントフォームとServer Action共用)。
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

const multiRelation = z
  .array(pageId)
  .max(100)
  .optional()
  .transform((v) => v ?? []);

export const customerWriteSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "表示名は必須です")
    .max(200, "表示名が長すぎます"),
  legalName: optionalText(200),
  officeName: optionalText(200),
  postalCode: optionalText(20),
  prefecture: optionalText(10),
  city: optionalText(100),
  addressLine: optionalText(200),
  phone: optionalText(50),
  email: optionalText(254).refine(
    (v) => v === null || /^\S+@\S+\.\S+$/.test(v),
    "メールアドレスの形式が不正です",
  ),
  representativeName: optionalText(100),
  website: optionalText(500),
  businessCategoryPageIds: multiRelation,
  tagPageIds: multiRelation,
  salesStatusPageId: singleRelation,
  acquisitionRoutePageId: singleRelation,
  priorityPageId: singleRelation,
  staffPageIds: multiRelation,
  relatedAccountPageIds: multiRelation,
  isArchived: z.boolean().optional().default(false),
});

export type CustomerWriteFormValues = z.input<typeof customerWriteSchema>;

/**
 * Zod検証 + relation一括検証。
 * write_operations作成・Notion API呼出より前に必ず通すこと。
 * 失敗時は CustomerSyncError("validation") を投げる(入力本文をメッセージに含めない)。
 */
export async function prepareCustomerWrite(input: {
  data: unknown;
  db: { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  context?: RelationValidationContext;
}): Promise<CustomerWriteInput> {
  const parsed = customerWriteSchema.safeParse(input.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join(".") ?? "";
    throw new CustomerSyncError(
      "validation",
      first?.message ?? "入力内容に誤りがあります",
      { reason: "schema", field },
    );
  }
  const loose = parsed.data as CustomerRelationLooseInput;
  const ids = collectCustomerRelationIds(loose);
  const lookup = await loadCustomerRelationLookup(input.db, ids);
  return validateCustomerRelations({
    write: loose,
    lookup,
    context: input.context,
  });
}
