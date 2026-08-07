"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { customerWriteSchema } from "@/lib/customers/write-schema";
import {
  createCustomerAction,
  updateCustomerAction,
  type CustomerActionResult,
} from "@/features/customers/actions";
import { linkInquiryCustomerAction } from "@/features/inquiries/actions";
import type { CustomerFormOptions } from "@/features/customers/options";
import { PREFECTURES } from "@/features/customers/format";

type FormValues = z.input<typeof customerWriteSchema>;
type ParsedValues = z.output<typeof customerWriteSchema>;

export type CustomerFormInitial = Partial<FormValues>;

export type CustomerFormMeta =
  | { mode: "create"; fromInquiryId?: string; successRedirect?: string }
  | {
      mode: "edit";
      notionPageId: string;
      externalId: string;
      lastEditedTime: string;
    };

/** 失敗後にrequest_idを再発行すべきreason(サーバー側でopがfailed等になり再利用不可) */
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

function MultiCheck({
  options,
  values,
  onToggle,
  emptyText,
}: {
  options: { id: string; label: string; inactive?: boolean }[];
  values: string[];
  onToggle: (id: string) => void;
  emptyText: string;
}) {
  if (options.length === 0) {
    return <p className="text-xs text-slate-400">{emptyText}</p>;
  }
  return (
    <div className="flex max-h-36 flex-wrap content-start gap-x-4 gap-y-1 overflow-y-auto rounded border border-slate-200 p-2">
      {options.map((o) => (
        <label key={o.id} className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={values.includes(o.id)}
            onChange={() => onToggle(o.id)}
          />
          <span className={o.inactive ? "text-slate-400" : ""}>
            {o.label}
            {o.inactive && (
              <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">
                無効
              </span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}

export function CustomerForm({
  meta,
  options,
  initial,
}: {
  meta: CustomerFormMeta;
  options: CustomerFormOptions;
  initial?: CustomerFormInitial;
}) {
  const router = useRouter();
  // 再レンダーで変わらないrequest_id。失敗種別により再発行する
  const [requestId, setRequestId] = useState<string>(() => newId());
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const defaults: FormValues = useMemo(
    () => ({
      displayName: initial?.displayName ?? "",
      legalName: initial?.legalName ?? "",
      officeName: initial?.officeName ?? "",
      postalCode: initial?.postalCode ?? "",
      prefecture: initial?.prefecture ?? "",
      city: initial?.city ?? "",
      addressLine: initial?.addressLine ?? "",
      phone: initial?.phone ?? "",
      email: initial?.email ?? "",
      representativeName: initial?.representativeName ?? "",
      website: initial?.website ?? "",
      businessCategoryPageIds: initial?.businessCategoryPageIds ?? [],
      tagPageIds: initial?.tagPageIds ?? [],
      salesStatusPageId: initial?.salesStatusPageId ?? null,
      acquisitionRoutePageId: initial?.acquisitionRoutePageId ?? null,
      priorityPageId: initial?.priorityPageId ?? null,
      staffPageIds: initial?.staffPageIds ?? [],
      relatedAccountPageIds: initial?.relatedAccountPageIds ?? [],
      isArchived: initial?.isArchived ?? false,
    }),
    [initial],
  );

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, ParsedValues>({
    resolver: zodResolver(customerWriteSchema),
    defaultValues: defaults,
  });
  const watched = useWatch({ control });

  const multi = (
    name:
      | "businessCategoryPageIds"
      | "tagPageIds"
      | "staffPageIds"
      | "relatedAccountPageIds",
  ) => {
    const values = (watched[name] ?? []) as string[];
    return {
      values,
      onToggle: (id: string) =>
        setValue(
          name,
          values.includes(id)
            ? values.filter((v) => v !== id)
            : [...values, id],
          { shouldDirty: true },
        ),
    };
  };
  const bizState = multi("businessCategoryPageIds");
  const tagState = multi("tagPageIds");
  const staffState = multi("staffPageIds");
  const relatedState = multi("relatedAccountPageIds");

  const singleSelect = (
    name: "salesStatusPageId" | "acquisitionRoutePageId" | "priorityPageId",
    list: { pageId: string; name: string; isActive: boolean }[],
  ) => {
    const raw = watched[name];
    const value = typeof raw === "string" ? raw : "";
    return (
      <select
        className={inputCls}
        value={value}
        onChange={(e) =>
          setValue(name, e.target.value || null, { shouldDirty: true })
        }
      >
        <option value="">未選択</option>
        {list.map((m) => (
          <option key={m.pageId} value={m.pageId}>
            {m.name}
            {!m.isActive ? "(無効)" : ""}
          </option>
        ))}
      </select>
    );
  };

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setConflict(false);
    let result: CustomerActionResult;
    if (meta.mode === "create") {
      result = await createCustomerAction({ requestId, data: values });
    } else {
      result = await updateCustomerAction({
        requestId,
        notionPageId: meta.notionPageId,
        externalId: meta.externalId,
        expectedLastEditedTime: meta.lastEditedTime,
        data: values,
      });
    }

    if (result.ok) {
      if (result.warning) {
        // 部分失敗(検索反映遅延)は遷移して問題ない
      }
      if (meta.mode === "create" && meta.fromInquiryId) {
        await linkInquiryCustomerAction({
          inquiryId: meta.fromInquiryId,
          customerPageId: result.notionPageId,
        });
        router.push(`/inquiries/${meta.fromInquiryId}`);
        router.refresh();
        return;
      }
      const dest =
        meta.mode === "create" && meta.successRedirect
          ? meta.successRedirect
          : `/customers/${result.notionPageId}`;
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
          <Field label="表示名" required error={errors.displayName?.message}>
            <input type="text" className={inputCls} {...register("displayName")} />
          </Field>
          <Field label="法人名" error={errors.legalName?.message}>
            <input type="text" className={inputCls} {...register("legalName")} />
          </Field>
          <Field label="事業所名" error={errors.officeName?.message}>
            <input type="text" className={inputCls} {...register("officeName")} />
          </Field>
          <Field label="代表者名" error={errors.representativeName?.message}>
            <input
              type="text"
              className={inputCls}
              {...register("representativeName")}
            />
          </Field>
          <Field label="Webサイト" error={errors.website?.message}>
            <input
              type="text"
              placeholder="https://"
              className={inputCls}
              {...register("website")}
            />
          </Field>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">所在地</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="郵便番号" error={errors.postalCode?.message}>
            <input
              type="text"
              placeholder="123-4567"
              className={inputCls}
              {...register("postalCode")}
            />
          </Field>
          <Field label="都道府県" error={errors.prefecture?.message}>
            <select className={inputCls} {...register("prefecture")}>
              <option value="">未選択</option>
              {PREFECTURES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="市区町村" error={errors.city?.message}>
            <input type="text" className={inputCls} {...register("city")} />
          </Field>
          <Field label="住所以降" error={errors.addressLine?.message}>
            <input type="text" className={inputCls} {...register("addressLine")} />
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
        <h2 className="mb-2 text-xs font-bold text-slate-700">営業情報</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label="営業ステータス">
            {singleSelect("salesStatusPageId", options.salesStatuses)}
          </Field>
          <Field label="集客ルート">
            {singleSelect("acquisitionRoutePageId", options.acquisitionRoutes)}
          </Field>
          <Field label="優先度">
            {singleSelect("priorityPageId", options.priorities)}
          </Field>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div>
            <p className={`${labelCls} mb-1`}>事業区分</p>
            <MultiCheck
              options={options.businessCategories.map((m) => ({
                id: m.pageId,
                label: m.name,
                inactive: !m.isActive,
              }))}
              values={bizState.values}
              onToggle={bizState.onToggle}
              emptyText="選択可能な事業区分がありません"
            />
          </div>
          <div>
            <p className={`${labelCls} mb-1`}>タグ</p>
            <MultiCheck
              options={options.tags.map((m) => ({
                id: m.pageId,
                label: m.name,
                inactive: !m.isActive,
              }))}
              values={tagState.values}
              onToggle={tagState.onToggle}
              emptyText="選択可能なタグがありません"
            />
          </div>
          <div>
            <p className={`${labelCls} mb-1`}>自社担当者</p>
            <MultiCheck
              options={options.staff.map((s) => ({
                id: s.pageId,
                label: s.name,
                inactive: !s.isActive,
              }))}
              values={staffState.values}
              onToggle={staffState.onToggle}
              emptyText="選択可能な担当者がありません"
            />
          </div>
          <div>
            <p className={`${labelCls} mb-1`}>関連アカウント</p>
            <MultiCheck
              options={options.relatedCustomers.map((c) => ({
                id: c.pageId,
                label: c.displayName,
                inactive: c.isArchived,
              }))}
              values={relatedState.values}
              onToggle={relatedState.onToggle}
              emptyText="選択可能な顧客がありません"
            />
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" {...register("isArchived")} />
          <span>アーカイブする(一覧の既定表示から除外。削除はしない)</span>
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
