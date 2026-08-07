import { z } from "zod";

import { ContractSyncError } from "@/lib/sync/errors";
import {
  collectContractRelationIds,
  loadContractRelationLookup,
  validateContractRelations,
  type ContractRelationLooseInput,
  type ContractRelationValidationContext,
} from "@/lib/contracts/validate-relations";
import type { ContractWriteInput } from "@/lib/contracts/types";

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

const optionalUrl = z
  .union([z.string().max(2000), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return null;
    const t = v.trim();
    return t ? t : null;
  })
  .refine(
    (v) => v === null || /^https?:\/\//i.test(v),
    "URLの形式が不正です",
  );

export const contractWriteSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "契約名は必須です")
      .max(200, "契約名が長すぎます"),
    customerPageId: requiredSingleRelation,
    dealPageId: singleRelation,
    contractTypePageId: singleRelation,
    tradeTypePageId: singleRelation,
    paymentStatusPageId: singleRelation,
    statusPageId: singleRelation,
    staffPageIds: multiRelation,
    amount: optionalNonNegInt,
    contractedAt: optionalDate,
    startDate: optionalDate,
    endDate: optionalDate,
    autoRenew: z.boolean().optional().transform((v) => v ?? false),
    billingTerms: optionalText(2000),
    contractUrl: optionalUrl,
    note: optionalText(2000),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate && data.startDate > data.endDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "契約終了日は開始日以降にしてください",
      });
    }
  });

export type ContractWriteFormValues = z.input<typeof contractWriteSchema>;

export async function prepareContractWrite(input: {
  data: unknown;
  db: { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  context?: ContractRelationValidationContext;
}): Promise<ContractWriteInput> {
  const parsed = contractWriteSchema.safeParse(input.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join(".") ?? "";
    throw new ContractSyncError(
      "validation",
      first?.message ?? "入力内容に誤りがあります",
      { reason: "schema", field },
    );
  }
  const loose = parsed.data as ContractRelationLooseInput;
  const ids = collectContractRelationIds(loose);
  const lookup = await loadContractRelationLookup(input.db, ids);
  return validateContractRelations({
    write: loose,
    lookup,
    context: input.context,
  });
}
