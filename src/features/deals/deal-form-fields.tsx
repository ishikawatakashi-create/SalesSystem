"use client";

import type {
  Control,
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
} from "react-hook-form";
import { useWatch } from "react-hook-form";

import type { DealClientFormValues } from "@/features/deals/form-schema";
import type { DealFormOptions } from "@/features/deals/options";

export const inputCls =
  "h-7 w-full rounded border border-slate-300 px-2 text-xs focus:border-primary focus:outline-none";
const labelCls = "text-xs text-slate-600";

export function Field({
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

export function MultiCheck({
  options,
  values,
  onToggle,
  emptyText,
  disabled,
}: {
  options: { id: string; label: string; inactive?: boolean }[];
  values: string[];
  onToggle: (id: string) => void;
  emptyText: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return <p className="text-xs text-slate-400">先に顧客を選択してください</p>;
  }
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

function errMsg(
  errors: FieldErrors<DealClientFormValues>,
  key: keyof DealClientFormValues,
): string | undefined {
  const e = errors[key];
  return typeof e?.message === "string" ? e.message : undefined;
}

export function DealFormFields({
  register,
  control,
  setValue,
  errors,
  options,
  lockedCustomerPageId,
  contactMismatch,
  onCustomerChange,
  onClearIncompatibleContacts,
}: {
  register: UseFormRegister<DealClientFormValues>;
  control: Control<DealClientFormValues>;
  setValue: UseFormSetValue<DealClientFormValues>;
  errors: FieldErrors<DealClientFormValues>;
  options: DealFormOptions;
  lockedCustomerPageId?: string;
  contactMismatch: {
    ids: string[];
    names: string[];
  } | null;
  onCustomerChange: (nextCustomerId: string) => void;
  onClearIncompatibleContacts: () => void;
}) {
  const watched = useWatch({ control });
  const lockedId = lockedCustomerPageId ?? null;
  const lockedCustomer = lockedId
    ? options.customers.find((c) => c.pageId === lockedId)
    : undefined;

  const customerId =
    typeof watched.customerPageId === "string" ? watched.customerPageId : "";
  const contactValues = (watched.contactPageIds ?? []) as string[];
  const staffValues = (watched.staffPageIds ?? []) as string[];

  const contactsForCustomer = customerId
    ? options.contacts.filter((c) => c.customerPageId === customerId)
    : [];

  const singleSelect = (
    name:
      | "businessCategoryPageId"
      | "stagePageId"
      | "statusPageId",
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
      {contactMismatch && contactMismatch.ids.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">
            選択中の顧客担当者が、現在の顧客に所属していません。
          </p>
          <p className="mt-0.5">
            対象: {contactMismatch.names.join("、") || "(不明)"}
          </p>
          <p className="mt-0.5">解除してから保存してください。</p>
          <button
            type="button"
            onClick={onClearIncompatibleContacts}
            className="mt-2 rounded border border-amber-400 bg-white px-3 py-1 hover:bg-amber-100"
          >
            対象外の担当者を解除
          </button>
        </div>
      )}

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">基本情報</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="案件名" required error={errMsg(errors, "title")}>
            <input type="text" className={inputCls} {...register("title")} />
          </Field>
          <Field
            label="顧客アカウント"
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
          <Field label="商材" error={errMsg(errors, "productName")}>
            <input
              type="text"
              className={inputCls}
              {...register("productName")}
            />
          </Field>
          <Field label="事業区分">
            {singleSelect("businessCategoryPageId", options.businessCategories)}
          </Field>
          <Field label="営業ステージ">
            {singleSelect("stagePageId", options.stages)}
          </Field>
          <Field label="ステータス">
            {singleSelect("statusPageId", options.statuses)}
          </Field>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">関係者</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Field label="顧客担当者" error={errMsg(errors, "contactPageIds")}>
            <MultiCheck
              disabled={!customerId}
              emptyText="この顧客に紐づく担当者はありません"
              options={contactsForCustomer.map((c) => ({
                id: c.pageId,
                label: c.name,
                inactive: !c.isActive,
              }))}
              values={contactValues}
              onToggle={(id) =>
                setValue(
                  "contactPageIds",
                  contactValues.includes(id)
                    ? contactValues.filter((v) => v !== id)
                    : [...contactValues, id],
                  { shouldDirty: true },
                )
              }
            />
          </Field>
          <Field label="自社担当者" error={errMsg(errors, "staffPageIds")}>
            <MultiCheck
              emptyText="自社担当者がいません"
              options={options.staff.map((s) => ({
                id: s.pageId,
                label: s.name,
                inactive: !s.isActive,
              }))}
              values={staffValues}
              onToggle={(id) =>
                setValue(
                  "staffPageIds",
                  staffValues.includes(id)
                    ? staffValues.filter((v) => v !== id)
                    : [...staffValues, id],
                  { shouldDirty: true },
                )
              }
            />
          </Field>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">金額・確度・日程</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="見込み金額(円)" error={errMsg(errors, "expectedAmount")}>
            <input
              type="text"
              inputMode="numeric"
              className={inputCls}
              placeholder="例: 1000000"
              {...register("expectedAmount")}
            />
          </Field>
          <Field label="契約金額(円)" error={errMsg(errors, "contractAmount")}>
            <input
              type="text"
              inputMode="numeric"
              className={inputCls}
              placeholder="例: 1000000"
              {...register("contractAmount")}
            />
          </Field>
          <Field label="確度(%)" error={errMsg(errors, "probability")}>
            <input
              type="text"
              inputMode="numeric"
              className={inputCls}
              placeholder="0〜100"
              {...register("probability")}
            />
          </Field>
          <Field
            label="見込みクローズ日"
            error={errMsg(errors, "expectedCloseDate")}
          >
            <input
              type="date"
              className={inputCls}
              {...register("expectedCloseDate")}
            />
          </Field>
          <Field label="受注日" error={errMsg(errors, "contractedAt")}>
            <input
              type="date"
              className={inputCls}
              {...register("contractedAt")}
            />
          </Field>
          <Field label="契約期間(開始)" error={errMsg(errors, "periodStart")}>
            <input
              type="date"
              className={inputCls}
              {...register("periodStart")}
            />
          </Field>
          <Field label="契約期間(終了)" error={errMsg(errors, "periodEnd")}>
            <input
              type="date"
              className={inputCls}
              {...register("periodEnd")}
            />
          </Field>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">失注理由・備考</h2>
        <div className="grid grid-cols-1 gap-2">
          <Field label="失注理由" error={errMsg(errors, "lostReason")}>
            <textarea
              rows={2}
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-primary focus:outline-none"
              {...register("lostReason")}
            />
          </Field>
          <Field label="備考" error={errMsg(errors, "note")}>
            <textarea
              rows={3}
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-primary focus:outline-none"
              {...register("note")}
            />
          </Field>
        </div>
      </section>
    </>
  );
}
