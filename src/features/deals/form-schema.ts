import { z } from "zod";

/**
 * クライアントフォーム用スキーマ。
 * HTML入力(文字列)を受け付け、write-schema と同等の制約へ正規化する。
 * 小数・負数・不正文字列は 0 へ丸めず拒否する。
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

const optionalYen = z.union([z.string(), z.number(), z.null(), z.undefined()])
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

const optionalProbability = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .superRefine((v, ctx) => {
    if (v === null || v === undefined || v === "") return;
    const message = "確度は0〜100の整数で入力してください";
    if (typeof v === "number") {
      if (!Number.isInteger(v) || v < 0 || v > 100) {
        ctx.addIssue({ code: "custom", message });
      }
      return;
    }
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) return;
      if (!/^\d+$/.test(t)) {
        ctx.addIssue({ code: "custom", message });
        return;
      }
      const n = Number(t);
      if (n < 0 || n > 100) {
        ctx.addIssue({ code: "custom", message });
      }
      return;
    }
    ctx.addIssue({ code: "custom", message });
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

export const dealClientFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "案件名は必須です")
      .max(200, "案件名が長すぎます"),
    customerPageId: z
      .string()
      .min(1, "顧客アカウントは必須です")
      .regex(PAGE_ID_RE, "顧客アカウントを選択してください"),
    contactPageIds: z.array(z.string().regex(PAGE_ID_RE)).max(100).default([]),
    businessCategoryPageId: optionalPageId,
    productName: optionalTextField(200),
    stagePageId: optionalPageId,
    staffPageIds: z.array(z.string().regex(PAGE_ID_RE)).max(100).default([]),
    expectedAmount: optionalYen,
    contractAmount: optionalYen,
    probability: optionalProbability,
    expectedCloseDate: optionalDate,
    contractedAt: optionalDate,
    periodStart: optionalDate,
    periodEnd: optionalDate,
    lostReason: optionalTextField(2000),
    statusPageId: optionalPageId,
    note: optionalTextField(2000),
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

export type DealClientFormValues = z.input<typeof dealClientFormSchema>;
export type DealClientFormParsed = z.output<typeof dealClientFormSchema>;

/** 表示用の初期値(数値は文字列化して入力欄へ) */
export function toDealFormDefaults(
  initial?: Partial<{
    title: string;
    customerPageId: string | null;
    contactPageIds: string[];
    businessCategoryPageId: string | null;
    productName: string | null;
    stagePageId: string | null;
    staffPageIds: string[];
    expectedAmount: number | null;
    contractAmount: number | null;
    probability: number | null;
    expectedCloseDate: string | null;
    contractedAt: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    lostReason: string | null;
    statusPageId: string | null;
    note: string | null;
  }>,
  lockedCustomerPageId?: string | null,
): DealClientFormValues {
  const yen = (n: number | null | undefined) =>
    n === null || n === undefined ? "" : String(n);
  return {
    title: initial?.title ?? "",
    customerPageId: lockedCustomerPageId ?? initial?.customerPageId ?? "",
    contactPageIds: initial?.contactPageIds ?? [],
    businessCategoryPageId: initial?.businessCategoryPageId ?? null,
    productName: initial?.productName ?? "",
    stagePageId: initial?.stagePageId ?? null,
    staffPageIds: initial?.staffPageIds ?? [],
    expectedAmount: yen(initial?.expectedAmount),
    contractAmount: yen(initial?.contractAmount),
    probability: yen(initial?.probability),
    expectedCloseDate: initial?.expectedCloseDate ?? "",
    contractedAt: initial?.contractedAt ?? "",
    periodStart: initial?.periodStart ?? "",
    periodEnd: initial?.periodEnd ?? "",
    lostReason: initial?.lostReason ?? "",
    statusPageId: initial?.statusPageId ?? null,
    note: initial?.note ?? "",
  };
}
