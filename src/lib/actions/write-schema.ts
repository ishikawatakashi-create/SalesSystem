import { z } from "zod";

import { ActionSyncError } from "@/lib/sync/errors";
import {
  collectActionRelationIds,
  loadActionRelationLookup,
  validateActionRelations,
  type ActionRelationLooseInput,
  type ActionRelationValidationContext,
} from "@/lib/actions/validate-relations";
import type { ActionWriteInput } from "@/lib/actions/types";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pageId = z.string().regex(PAGE_ID_RE, "IDの形式が不正です");

const singleRelation = z
  .union([pageId, z.array(pageId).max(10), z.null()])
  .optional()
  .transform((v) => (v === undefined ? null : v));

const requiredSingleRelation = z
  .union([pageId, z.array(pageId).max(10)])
  .transform((v) => v);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const requiredDate = z
  .string()
  .trim()
  .min(1, "期限は必須です")
  .refine((v) => DATE_RE.test(v), "日付の形式が不正です");

const optionalDateOrDateTime = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return null;
    const t = v.trim();
    return t ? t : null;
  })
  .refine(
    (v) => v === null || !Number.isNaN(Date.parse(v)),
    "完了日時の形式が不正です",
  );

export const actionWriteSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "アクション内容は必須です")
    .max(200, "アクション内容が長すぎます"),
  customerPageId: requiredSingleRelation,
  dealPageId: singleRelation,
  activityPageId: singleRelation,
  staffPageId: singleRelation,
  dueDate: requiredDate,
  statusPageId: requiredSingleRelation,
  priorityPageId: singleRelation,
  completedAt: optionalDateOrDateTime,
});

export type ActionWriteFormValues = z.input<typeof actionWriteSchema>;

export async function prepareActionWrite(input: {
  data: unknown;
  db: { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  context?: ActionRelationValidationContext;
}): Promise<ActionWriteInput> {
  const parsed = actionWriteSchema.safeParse(input.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join(".") ?? "";
    throw new ActionSyncError(
      "validation",
      first?.message ?? "入力内容に誤りがあります",
      { reason: "schema", field },
    );
  }
  const loose = parsed.data as ActionRelationLooseInput;
  const ids = collectActionRelationIds(loose);
  const lookup = await loadActionRelationLookup(input.db, ids);
  return validateActionRelations({
    write: loose,
    lookup,
    context: input.context,
  });
}
