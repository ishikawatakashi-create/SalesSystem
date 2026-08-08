"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { contactWriteSchema } from "@/lib/contacts/write-schema";
import {
  createContactAction,
  updateContactAction,
  type ContactActionResult,
} from "@/features/contacts/actions";
import { linkInquiryCustomerAction } from "@/features/inquiries/actions";
import type { ContactFormOptions } from "@/features/contacts/options";

type FormValues = z.input<typeof contactWriteSchema>;
type ParsedValues = z.output<typeof contactWriteSchema>;

export type ContactFormInitial = Partial<FormValues>;

export type ContactFormMeta =
  | { mode: "create"; successRedirect?: string; fromInquiryId?: string }
  | {
      mode: "edit";
      notionPageId: string;
      externalId: string;
      lastEditedTime: string;
      successRedirect?: string;
    };

/** 失敗後にrequest_idを再発行すべきreason */
const REGENERATE_REASONS = new Set([
  "notion_failed",
  "forbidden_state",
  "input_hash_mismatch",
  "no_page",
  "unknown",
]);

function newId(): string {
  return crypto.randomUUID();
}

const inputCls =
  "h-7 w-full rounded border border-slate-300 px-2 text-xs focus:border-primary focus:outline-none";
const labelCls = "text-xs text-slate-600";

function Field({
  label,
  required,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-0.5 ${className ?? ""}`}>
      <span className={labelCls}>
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      {children}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function ContactForm({
  meta,
  options,
  initial,
  lockedCustomerPageId,
}: {
  meta: ContactFormMeta;
  options: ContactFormOptions;
  initial?: ContactFormInitial;
  /** 顧客詳細からの新規時など。値は送信し、UIは読取専用表示 */
  lockedCustomerPageId?: string;
}) {
  const router = useRouter();
  const [requestId, setRequestId] = useState<string>(() => newId());
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const lockedId = lockedCustomerPageId ?? null;
  const lockedCustomer = lockedId
    ? options.customers.find((c) => c.pageId === lockedId)
    : undefined;

  const defaults: FormValues = useMemo(
    () => ({
      name: initial?.name ?? "",
      nameKana: initial?.nameKana ?? "",
      customerPageId: lockedId ?? initial?.customerPageId ?? "",
      department: initial?.department ?? "",
      title: initial?.title ?? "",
      phone: initial?.phone ?? "",
      email: initial?.email ?? "",
      contactTypePageId: initial?.contactTypePageId ?? null,
      note: initial?.note ?? "",
      isActive: initial?.isActive ?? true,
    }),
    [initial, lockedId],
  );

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, ParsedValues>({
    resolver: zodResolver(contactWriteSchema),
    defaultValues: defaults,
  });
  const watched = useWatch({ control });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setConflict(false);
    const payload = {
      ...values,
      customerPageId: lockedId ?? values.customerPageId,
    };
    let result: ContactActionResult;
    if (meta.mode === "create") {
      result = await createContactAction({ requestId, data: payload });
    } else {
      result = await updateContactAction({
        requestId,
        notionPageId: meta.notionPageId,
        externalId: meta.externalId,
        expectedLastEditedTime: meta.lastEditedTime,
        data: payload,
      });
    }

    if (result.ok) {
      if (meta.mode === "create" && meta.fromInquiryId) {
        await linkInquiryCustomerAction({
          inquiryId: meta.fromInquiryId,
          customerPageId: String(lockedId ?? payload.customerPageId),
          contactPageId: result.notionPageId,
        });
        router.push(`/inquiries/${meta.fromInquiryId}`);
        router.refresh();
        return;
      }
      const dest =
        meta.successRedirect ?? `/contacts/${result.notionPageId}`;
      router.push(dest);
      router.refresh();
      return;
    }
    if (result.reason === "conflict") {
      setConflict(true);
      return;
    }
    setServerError(result.message);
    if (result.reason && REGENERATE_REASONS.has(result.reason)) {
      setRequestId(newId());
    }
  });

  const typeValue =
    typeof watched.contactTypePageId === "string"
      ? watched.contactTypePageId
      : "";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {conflict && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">他のユーザーによる変更があります。</p>
          <p className="mt-0.5">
            上書きを防ぐため保存を中止しました。再読込して最新の内容を確認してください。
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded border border-amber-400 bg-white px-3 py-1 hover:bg-amber-100"
          >
            再読込
          </button>
        </div>
      )}
      {serverError && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-xs text-red-800">
          {serverError}
        </div>
      )}

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">基本情報</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="氏名" required error={errors.name?.message}>
            <input type="text" className={inputCls} {...register("name")} />
          </Field>
          <Field label="氏名よみ" error={errors.nameKana?.message}>
            <input type="text" className={inputCls} {...register("nameKana")} />
          </Field>
          <Field
            label="所属組織"
            required
            error={
              typeof errors.customerPageId?.message === "string"
                ? errors.customerPageId.message
                : undefined
            }
          >
            {lockedId ? (
              <>
                <input type="hidden" {...register("customerPageId")} />
                <div className="flex h-7 items-center rounded border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700">
                  {lockedCustomer?.displayName ?? "(不明)"}
                  {lockedCustomer?.isArchived && (
                    <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">
                      アーカイブ
                    </span>
                  )}
                </div>
              </>
            ) : (
              <select className={inputCls} {...register("customerPageId")}>
                <option value="">選択してください</option>
                {options.customers.map((c) => (
                  <option key={c.pageId} value={c.pageId}>
                    {c.displayName}
                    {c.isArchived ? "(アーカイブ)" : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="部署" error={errors.department?.message}>
            <input
              type="text"
              className={inputCls}
              {...register("department")}
            />
          </Field>
          <Field label="役職" error={errors.title?.message}>
            <input type="text" className={inputCls} {...register("title")} />
          </Field>
          <Field label="担当者区分">
            <select
              className={inputCls}
              value={typeValue}
              onChange={(e) =>
                setValue("contactTypePageId", e.target.value || null, {
                  shouldDirty: true,
                })
              }
            >
              <option value="">未選択</option>
              {options.contactTypes.map((m) => (
                <option key={m.pageId} value={m.pageId}>
                  {m.name}
                  {!m.isActive ? "(無効)" : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">連絡先</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="電話番号" error={errors.phone?.message}>
            <input type="tel" className={inputCls} {...register("phone")} />
          </Field>
          <Field label="メールアドレス" error={errors.email?.message}>
            <input type="text" className={inputCls} {...register("email")} />
          </Field>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">備考</h2>
        <Field label="備考" error={errors.note?.message}>
          <textarea
            rows={3}
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-primary focus:outline-none"
            {...register("note")}
          />
        </Field>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" {...register("isActive")} />
          <span>有効(オフにすると一覧の既定表示から除外。削除はしない)</span>
        </label>
      </section>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting || conflict}
          className="rounded bg-primary px-4 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting
            ? "保存中..."
            : meta.mode === "create"
              ? "登録する"
              : "保存する"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={isSubmitting}
          className="rounded border border-slate-300 bg-white px-4 py-1.5 text-xs hover:bg-slate-50"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
