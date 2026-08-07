import { z } from "zod";

/**
 * クライアントフォーム用スキーマ。
 * HTML入力を受け付け、write-schema と同等の制約へ正規化する。
 */

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const optionalTextField = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === null || v === undefined) return null;
      const t = v.trim();
      return t ? t : null;
    })
    .refine((v) => v === null || v.length <= max, "文字数が長すぎます");

const optionalPageId = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (!v || !String(v).trim()) return null;
    return String(v);
  })
  .refine((v) => v === null || PAGE_ID_RE.test(v), "IDの形式が不正です");

const optionalDate = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const t = v.trim();
    return t ? t : null;
  })
  .refine((v) => v === null || DATE_RE.test(v), "日付の形式が不正です");

const bodySection = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const t = v.trim();
    return t ? v : null;
  })
  .refine((v) => v === null || v.length <= 100_000, "本文が長すぎます");

export const complaintClientFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "タイトルは必須です")
    .max(200, "タイトルが長すぎます"),
  customerPageId: z
    .string()
    .min(1, "顧客アカウントは必須です")
    .regex(PAGE_ID_RE, "顧客アカウントを選択してください"),
  dealPageId: optionalPageId,
  severityPageId: optionalPageId,
  statusPageId: optionalPageId,
  staffPageId: optionalPageId,
  occurredOn: optionalDate,
  summary: optionalTextField(500),
  dueDate: optionalDate,
  completedOn: optionalDate,
  note: optionalTextField(2000),
  content: bodySection,
  cause: bodySection,
  response: bodySection,
  prevention: bodySection,
});

export type ComplaintClientFormValues = z.input<
  typeof complaintClientFormSchema
>;
export type ComplaintClientFormParsed = z.output<
  typeof complaintClientFormSchema
>;

export function toComplaintFormDefaults(
  initial?: Partial<{
    title: string;
    customerPageId: string | null;
    dealPageId: string | null;
    severityPageId: string | null;
    statusPageId: string | null;
    staffPageId: string | null;
    occurredOn: string | null;
    summary: string | null;
    dueDate: string | null;
    completedOn: string | null;
    note: string | null;
    content: string | null;
    cause: string | null;
    response: string | null;
    prevention: string | null;
  }>,
  lockedCustomerPageId?: string | null,
): ComplaintClientFormValues {
  return {
    title: initial?.title ?? "",
    customerPageId: lockedCustomerPageId ?? initial?.customerPageId ?? "",
    dealPageId: initial?.dealPageId ?? null,
    severityPageId: initial?.severityPageId ?? null,
    statusPageId: initial?.statusPageId ?? null,
    staffPageId: initial?.staffPageId ?? null,
    occurredOn: initial?.occurredOn ?? "",
    summary: initial?.summary ?? "",
    dueDate: initial?.dueDate ?? "",
    completedOn: initial?.completedOn ?? "",
    note: initial?.note ?? "",
    content: initial?.content ?? "",
    cause: initial?.cause ?? "",
    response: initial?.response ?? "",
    prevention: initial?.prevention ?? "",
  };
}
