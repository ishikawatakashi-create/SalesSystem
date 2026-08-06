import { z } from "zod";

import { DealSyncError } from "@/lib/sync/errors";
import {
  collectDealRelationIds,
  loadDealRelationLookup,
  validateDealRelations,
  type DealRelationLooseInput,
  type DealRelationValidationContext,
} from "@/lib/deals/validate-relations";
import type { DealWriteInput } from "@/lib/deals/types";

/**
 * 案件書込のZodスキーマ(クライアントフォームとServer Action共用)。
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

const multiRelation = z
  .array(pageId)
  .max(100)
  .optional()
  .transform((v) => v ?? []);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const optionalDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return null;
    const t = v.trim();
    return t ? t : null;
  })
  .refine((v) => v === null || DATE_RE.test(v), "日付の形式が不正です");

/**
 * null | 非負整数。小数・負数・文字列からの暗黙変換(→0)を拒否。
 */
const optionalNonNegInt = z
  .union([z.number(), z.null()])
  .optional()
  .superRefine((v, ctx) => {
    if (v === undefined || v === null) return;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      ctx.addIssue({
        code: "custom",
        message: "0以上の整数で入力してください",
      });
    }
  })
  .transform((v) => (v === undefined ? null : v));

/**
 * null | 0-100 整数。小数・範囲外・文字列→0を拒否。
 */
const optionalProbability = z
  .union([z.number(), z.null()])
  .optional()
  .superRefine((v, ctx) => {
    if (v === undefined || v === null) return;
    if (
      typeof v !== "number" ||
      !Number.isInteger(v) ||
      v < 0 ||
      v > 100
    ) {
      ctx.addIssue({
        code: "custom",
        message: "確度は0〜100の整数で入力してください",
      });
    }
  })
  .transform((v) => (v === undefined ? null : v));

export const dealWriteSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "案件名は必須です")
      .max(200, "案件名が長すぎます"),
    customerPageId: requiredSingleRelation,
    contactPageIds: multiRelation,
    businessCategoryPageId: singleRelation,
    productName: optionalText(200),
    stagePageId: singleRelation,
    staffPageIds: multiRelation,
    expectedAmount: optionalNonNegInt,
    contractAmount: optionalNonNegInt,
    probability: optionalProbability,
    expectedCloseDate: optionalDate,
    contractedAt: optionalDate,
    periodStart: optionalDate,
    periodEnd: optionalDate,
    lostReason: optionalText(2000),
    statusPageId: singleRelation,
    note: optionalText(2000),
  })
  .superRefine((data, ctx) => {
    if (
      data.periodStart &&
      data.periodEnd &&
      data.periodStart > data.periodEnd
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "契約期間の終了日は開始日以降にしてください",
      });
    }
  });

export type DealWriteFormValues = z.input<typeof dealWriteSchema>;

/**
 * Zod検証 + relation一括検証。
 * write_operations作成・Notion API呼出より前に必ず通すこと。
 * 失敗時は DealSyncError("validation") を投げる(入力本文をメッセージに含めない)。
 */
export async function prepareDealWrite(input: {
  data: unknown;
  db: { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  context?: DealRelationValidationContext;
}): Promise<DealWriteInput> {
  const parsed = dealWriteSchema.safeParse(input.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join(".") ?? "";
    throw new DealSyncError(
      "validation",
      first?.message ?? "入力内容に誤りがあります",
      { reason: "schema", field },
    );
  }
  const loose = parsed.data as DealRelationLooseInput;
  const ids = collectDealRelationIds(loose);
  const lookup = await loadDealRelationLookup(input.db, ids);
  return validateDealRelations({
    write: loose,
    lookup,
    context: input.context,
  });
}
