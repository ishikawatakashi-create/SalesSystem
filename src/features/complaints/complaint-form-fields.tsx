"use client";

import type {
  Control,
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
} from "react-hook-form";
import { useWatch } from "react-hook-form";

import type { ComplaintClientFormValues } from "@/features/complaints/form-schema";
import type { ComplaintFormOptions } from "@/features/complaints/options";

export const inputCls =
  "h-7 w-full rounded border border-slate-300 px-2 text-xs focus:border-primary focus:outline-none";
const labelCls = "text-xs text-slate-600";
const textareaCls =
  "w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-primary focus:outline-none";

export function Field({
  label,
  required,
  error,
  children,
  className,
  hint,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    <label className={`flex flex-col gap-0.5 ${className ?? ""}`}>
      <span className={labelCls}>
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      {children}
      {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}

function errMsg(
  errors: FieldErrors<ComplaintClientFormValues>,
  key: keyof ComplaintClientFormValues,
): string | undefined {
  const e = errors[key];
  return typeof e?.message === "string" ? e.message : undefined;
}

export function ComplaintFormFields({
  register,
  control,
  setValue,
  errors,
  options,
  lockedCustomerPageId,
  lockedDealPageId,
  onCustomerChange,
}: {
  register: UseFormRegister<ComplaintClientFormValues>;
  control: Control<ComplaintClientFormValues>;
  setValue: UseFormSetValue<ComplaintClientFormValues>;
  errors: FieldErrors<ComplaintClientFormValues>;
  options: ComplaintFormOptions;
  lockedCustomerPageId?: string;
  lockedDealPageId?: string;
  onCustomerChange: (nextCustomerId: string) => void;
}) {
  const watched = useWatch({ control });
  const lockedId = lockedCustomerPageId ?? null;
  const lockedCustomer = lockedId
    ? options.customers.find((c) => c.pageId === lockedId)
    : undefined;
  const lockedDeal = lockedDealPageId
    ? options.deals.find((d) => d.pageId === lockedDealPageId)
    : undefined;

  const customerId =
    typeof watched.customerPageId === "string" ? watched.customerPageId : "";
  const dealsForCustomer = customerId
    ? options.deals.filter((d) => d.customerPageId === customerId)
    : [];

  const singleSelect = (
    name:
      | "dealPageId"
      | "severityPageId"
      | "statusPageId"
      | "staffPageId",
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

  return (
    <>
      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">基本情報</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="タイトル" required error={errMsg(errors, "title")}>
            <input type="text" className={inputCls} {...register("title")} />
          </Field>
          <Field
            label="組織"
            required
            error={errMsg(errors, "customerPageId")}
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
              <select
                className={inputCls}
                value={customerId}
                onChange={(e) => onCustomerChange(e.target.value)}
              >
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
          <Field label="関連案件" error={errMsg(errors, "dealPageId")}>
            {lockedDealPageId ? (
              <>
                <input type="hidden" {...register("dealPageId")} />
                <div className="flex h-7 items-center rounded border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700">
                  {lockedDeal?.title ?? "(不明)"}
                </div>
              </>
            ) : (
              singleSelect(
                "dealPageId",
                dealsForCustomer.map((d) => ({
                  pageId: d.pageId,
                  name: d.title,
                  isActive: true,
                })),
              )
            )}
          </Field>
          <Field label="重要度">
            {singleSelect("severityPageId", options.severities)}
          </Field>
          <Field label="対応状況">
            {singleSelect("statusPageId", options.statuses)}
          </Field>
          <Field label="対応責任者">
            {singleSelect("staffPageId", options.staff)}
          </Field>
          <Field label="発生日" error={errMsg(errors, "occurredOn")}>
            <input
              type="date"
              className={inputCls}
              {...register("occurredOn")}
            />
          </Field>
          <Field label="対応期限" error={errMsg(errors, "dueDate")}>
            <input type="date" className={inputCls} {...register("dueDate")} />
          </Field>
          <Field label="完了日" error={errMsg(errors, "completedOn")}>
            <input
              type="date"
              className={inputCls}
              {...register("completedOn")}
            />
          </Field>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">概要・本文</h2>
        <div className="grid grid-cols-1 gap-2">
          <Field
            label="概要"
            error={errMsg(errors, "summary")}
            hint="空欄の場合は本文から自動生成されます"
          >
            <textarea rows={2} className={textareaCls} {...register("summary")} />
          </Field>
          <Field label="内容" error={errMsg(errors, "content")}>
            <textarea rows={4} className={textareaCls} {...register("content")} />
          </Field>
          <Field label="原因" error={errMsg(errors, "cause")}>
            <textarea rows={3} className={textareaCls} {...register("cause")} />
          </Field>
          <Field label="対応" error={errMsg(errors, "response")}>
            <textarea
              rows={3}
              className={textareaCls}
              {...register("response")}
            />
          </Field>
          <Field label="再発防止" error={errMsg(errors, "prevention")}>
            <textarea
              rows={3}
              className={textareaCls}
              {...register("prevention")}
            />
          </Field>
          <Field label="備考" error={errMsg(errors, "note")}>
            <textarea rows={2} className={textareaCls} {...register("note")} />
          </Field>
        </div>
      </section>
    </>
  );
}
