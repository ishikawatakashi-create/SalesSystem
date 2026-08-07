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

const optionalYen = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .superRefine((v, ctx) => {
    if (v === null || v === undefined || v === "") return;
    if (typeof v === "number") {
      if (!Number.isInteger(v) || v < 0) {
        ctx.addIssue({
          code: "custom",
          message: "0以上の整数で入力してください",
        });
      }
      return;
    }
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) return;
      if (!/^\d+$/.test(t)) {
        ctx.addIssue({
          code: "custom",
          message: "0以上の整数で入力してください",
        });
      }
      return;
    }
    ctx.addIssue({
      code: "custom",
      message: "0以上の整数で入力してください",
    });
  })
  .transform((v): number | null => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v;
    const t = String(v).trim();
    if (!t) return null;
    return Number(t);
  });

const optionalDate = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const t = v.trim();
    return t ? t : null;
  })
  .refine((v) => v === null || DATE_RE.test(v), "日付の形式が不正です");

const optionalUrl = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const t = v.trim();
    return t ? t : null;
  })
  .refine((v) => v === null || v.length <= 2000, "URLが長すぎます")
  .refine(
    (v) => v === null || /^https?:\/\//i.test(v),
    "URLの形式が不正です",
  );

export const contractClientFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "契約名は必須です")
      .max(200, "契約名が長すぎます"),
    customerPageId: z
      .string()
      .min(1, "顧客アカウントは必須です")
      .regex(PAGE_ID_RE, "顧客アカウントを選択してください"),
    dealPageId: optionalPageId,
    contractTypePageId: optionalPageId,
    tradeTypePageId: optionalPageId,
    paymentStatusPageId: optionalPageId,
    statusPageId: optionalPageId,
    staffPageIds: z.array(z.string().regex(PAGE_ID_RE)).max(100).default([]),
    amount: optionalYen,
    contractedAt: optionalDate,
    startDate: optionalDate,
    endDate: optionalDate,
    autoRenew: z.boolean().default(false),
    billingTerms: optionalTextField(2000),
    contractUrl: optionalUrl,
    note: optionalTextField(2000),
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

export type ContractClientFormValues = z.input<typeof contractClientFormSchema>;
export type ContractClientFormParsed = z.output<typeof contractClientFormSchema>;

export function toContractFormDefaults(
  initial?: Partial<{
    title: string;
    customerPageId: string | null;
    dealPageId: string | null;
    contractTypePageId: string | null;
    tradeTypePageId: string | null;
    paymentStatusPageId: string | null;
    statusPageId: string | null;
    staffPageIds: string[];
    amount: number | null;
    contractedAt: string | null;
    startDate: string | null;
    endDate: string | null;
    autoRenew: boolean;
    billingTerms: string | null;
    contractUrl: string | null;
    note: string | null;
  }>,
  lockedCustomerPageId?: string | null,
): ContractClientFormValues {
  const yen = (n: number | null | undefined) =>
    n === null || n === undefined ? "" : String(n);
  return {
    title: initial?.title ?? "",
    customerPageId: lockedCustomerPageId ?? initial?.customerPageId ?? "",
    dealPageId: initial?.dealPageId ?? null,
    contractTypePageId: initial?.contractTypePageId ?? null,
    tradeTypePageId: initial?.tradeTypePageId ?? null,
    paymentStatusPageId: initial?.paymentStatusPageId ?? null,
    statusPageId: initial?.statusPageId ?? null,
    staffPageIds: initial?.staffPageIds ?? [],
    amount: yen(initial?.amount),
    contractedAt: initial?.contractedAt ?? "",
    startDate: initial?.startDate ?? "",
    endDate: initial?.endDate ?? "",
    autoRenew: initial?.autoRenew ?? false,
    billingTerms: initial?.billingTerms ?? "",
    contractUrl: initial?.contractUrl ?? "",
    note: initial?.note ?? "",
  };
}
