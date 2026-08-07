import { z } from "zod";

import { ComplaintSyncError } from "@/lib/sync/errors";
import {
  collectComplaintRelationIds,
  loadComplaintRelationLookup,
  validateComplaintRelations,
  type ComplaintRelationLooseInput,
  type ComplaintRelationValidationContext,
} from "@/lib/complaints/validate-relations";
import type { ComplaintWriteInput } from "@/lib/complaints/types";

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

const bodySection = z
  .union([z.string().max(100_000), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return null;
    const t = v.trim();
    return t ? v : null;
  });

const singleRelation = z
  .union([pageId, z.array(pageId).max(10), z.null()])
  .optional()
  .transform((v) => (v === undefined ? null : v));

const requiredSingleRelation = z
  .union([pageId, z.array(pageId).max(10)])
  .transform((v) => v);

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

export const complaintWriteSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "タイトルは必須です")
    .max(200, "タイトルが長すぎます"),
  customerPageId: requiredSingleRelation,
  dealPageId: singleRelation,
  severityPageId: singleRelation,
  statusPageId: singleRelation,
  staffPageId: singleRelation,
  occurredOn: optionalDate,
  summary: optionalText(500),
  dueDate: optionalDate,
  completedOn: optionalDate,
  note: optionalText(2000),
  content: bodySection,
  cause: bodySection,
  response: bodySection,
  prevention: bodySection,
});

export type ComplaintWriteFormValues = z.input<typeof complaintWriteSchema>;

export async function prepareComplaintWrite(input: {
  data: unknown;
  db: { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  context?: ComplaintRelationValidationContext;
}): Promise<ComplaintWriteInput> {
  const parsed = complaintWriteSchema.safeParse(input.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join(".") ?? "";
    throw new ComplaintSyncError(
      "validation",
      first?.message ?? "入力内容に誤りがあります",
      { reason: "schema", field },
    );
  }
  const loose = parsed.data as ComplaintRelationLooseInput;
  const ids = collectComplaintRelationIds(loose);
  const lookup = await loadComplaintRelationLookup(input.db, ids);
  return validateComplaintRelations({
    write: loose,
    lookup,
    context: input.context,
  });
}
