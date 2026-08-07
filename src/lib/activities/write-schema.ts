import { z } from "zod";

import { ActivitySyncError } from "@/lib/sync/errors";
import {
  collectActivityRelationIds,
  loadActivityRelationLookup,
  validateActivityRelations,
  type ActivityRelationLooseInput,
  type ActivityRelationValidationContext,
} from "@/lib/activities/validate-relations";
import type { ActivityWriteInput } from "@/lib/activities/types";

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

/** 対応日時: ISO日付または日時 */
const activityAtSchema = z
  .string()
  .trim()
  .min(1, "対応日時は必須です")
  .refine((v) => !Number.isNaN(Date.parse(v)), "対応日時の形式が不正です");

export const activityWriteSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "タイトルは必須です")
    .max(200, "タイトルが長すぎます"),
  customerPageId: requiredSingleRelation,
  dealPageId: singleRelation,
  contactPageIds: multiRelation,
  activityAt: activityAtSchema,
  categoryPageIds: multiRelation,
  summary: optionalText(500),
  nextActionNote: optionalText(2000),
  nextActionDate: optionalDate,
  body: z.string().max(100_000).optional().transform((v) => v ?? ""),
  batchId: optionalText(100),
});

export type ActivityWriteFormValues = z.input<typeof activityWriteSchema>;

export async function prepareActivityWrite(input: {
  data: unknown;
  db: { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  context?: ActivityRelationValidationContext;
}): Promise<ActivityWriteInput> {
  const parsed = activityWriteSchema.safeParse(input.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join(".") ?? "";
    throw new ActivitySyncError(
      "validation",
      first?.message ?? "入力内容に誤りがあります",
      { reason: "schema", field },
    );
  }
  const loose = parsed.data as ActivityRelationLooseInput;
  const ids = collectActivityRelationIds(loose);
  const lookup = await loadActivityRelationLookup(input.db, ids);
  return validateActivityRelations({
    write: loose,
    lookup,
    context: input.context,
  });
}
