import { z } from "zod";

/**
 * クライアントフォーム用スキーマ。
 * 先方担当者フィールドは存在しない。
 */

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const optionalPageId = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (!v || !String(v).trim()) return null;
    return String(v);
  })
  .refine((v) => v === null || PAGE_ID_RE.test(v), "IDの形式が不正です");

const optionalDateOrDateTime = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const t = v.trim();
    return t ? t : null;
  })
  .refine(
    (v) => v === null || !Number.isNaN(Date.parse(v)),
    "完了日時の形式が不正です",
  );

export const actionClientFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "アクション内容は必須です")
    .max(200, "アクション内容が長すぎます"),
  customerPageId: z
    .string()
    .min(1, "顧客アカウントは必須です")
    .regex(PAGE_ID_RE, "顧客アカウントを選択してください"),
  dealPageId: optionalPageId,
  activityPageId: optionalPageId,
  staffPageId: optionalPageId,
  dueDate: z
    .string()
    .trim()
    .min(1, "期限は必須です")
    .refine((v) => DATE_RE.test(v), "日付の形式が不正です"),
  statusPageId: z
    .string()
    .min(1, "状態は必須です")
    .regex(PAGE_ID_RE, "状態を選択してください"),
  priorityPageId: optionalPageId,
  completedAt: optionalDateOrDateTime,
});

export type ActionClientFormValues = z.input<typeof actionClientFormSchema>;
export type ActionClientFormParsed = z.output<typeof actionClientFormSchema>;

export function toActionFormDefaults(
  initial?: Partial<{
    title: string;
    customerPageId: string | null;
    dealPageId: string | null;
    activityPageId: string | null;
    staffPageId: string | null;
    dueDate: string | null;
    statusPageId: string | null;
    priorityPageId: string | null;
    completedAt: string | null;
  }>,
  lockedCustomerPageId?: string | null,
  defaultOpenStatusPageId?: string | null,
): ActionClientFormValues {
  return {
    title: initial?.title ?? "",
    customerPageId: lockedCustomerPageId ?? initial?.customerPageId ?? "",
    dealPageId: initial?.dealPageId ?? null,
    activityPageId: initial?.activityPageId ?? null,
    staffPageId: initial?.staffPageId ?? null,
    dueDate: initial?.dueDate ?? "",
    statusPageId:
      initial?.statusPageId ?? defaultOpenStatusPageId ?? "",
    priorityPageId: initial?.priorityPageId ?? null,
    completedAt: initial?.completedAt ?? "",
  };
}
