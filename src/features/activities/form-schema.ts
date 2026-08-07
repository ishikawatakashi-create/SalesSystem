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

export const activityClientFormSchema = z.object({
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
  contactPageIds: z.array(z.string().regex(PAGE_ID_RE)).max(100).default([]),
  activityAt: z
    .string()
    .trim()
    .min(1, "対応日時は必須です")
    .refine((v) => !Number.isNaN(Date.parse(v)), "対応日時の形式が不正です"),
  categoryPageIds: z.array(z.string().regex(PAGE_ID_RE)).max(100).default([]),
  summary: optionalTextField(500),
  nextActionNote: optionalTextField(2000),
  nextActionDate: optionalDate,
  body: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (typeof v === "string" ? v : ""))
    .refine((v) => v.length <= 100_000, "本文が長すぎます"),
  /** UI専用: 続けて次回アクションを登録 */
  createNextAction: z.boolean().default(false),
  nextActionTitle: optionalTextField(200),
  nextActionDueDate: optionalDate,
  nextActionStaffPageId: optionalPageId,
  nextActionPriorityPageId: optionalPageId,
});

export type ActivityClientFormValues = z.input<typeof activityClientFormSchema>;
export type ActivityClientFormParsed = z.output<typeof activityClientFormSchema>;

export function toActivityFormDefaults(
  initial?: Partial<{
    title: string;
    customerPageId: string | null;
    dealPageId: string | null;
    contactPageIds: string[];
    activityAt: string | null;
    categoryPageIds: string[];
    summary: string | null;
    nextActionNote: string | null;
    nextActionDate: string | null;
    body: string;
  }>,
  lockedCustomerPageId?: string | null,
): ActivityClientFormValues {
  const nowLocal = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day}T${hh}:${mm}`;
  })();

  return {
    title: initial?.title ?? "",
    customerPageId: lockedCustomerPageId ?? initial?.customerPageId ?? "",
    dealPageId: initial?.dealPageId ?? null,
    contactPageIds: initial?.contactPageIds ?? [],
    activityAt: initial?.activityAt ?? nowLocal,
    categoryPageIds: initial?.categoryPageIds ?? [],
    summary: initial?.summary ?? "",
    nextActionNote: initial?.nextActionNote ?? "",
    nextActionDate: initial?.nextActionDate ?? "",
    body: initial?.body ?? "",
    createNextAction: false,
    nextActionTitle: "",
    nextActionDueDate: "",
    nextActionStaffPageId: null,
    nextActionPriorityPageId: null,
  };
}
