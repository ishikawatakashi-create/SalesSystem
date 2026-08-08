"use client";

import type {
  Control,
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
} from "react-hook-form";
import { useWatch } from "react-hook-form";

import type { ContractClientFormValues } from "@/features/contracts/form-schema";
import type { ContractFormOptions } from "@/features/contracts/options";

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

function errMsg(
  errors: FieldErrors<ContractClientFormValues>,
  key: keyof ContractClientFormValues,
): string | undefined {
  const e = errors[key];
  return typeof e?.message === "string" ? e.message : undefined;
}

export function ContractFormFields({
  register,
  control,
  setValue,
  errors,
  options,
  lockedCustomerPageId,
  lockedDealPageId,
  onCustomerChange,
}: {
  register: UseFormRegister<ContractClientFormValues>;
  control: Control<ContractClientFormValues>;
  setValue: UseFormSetValue<ContractClientFormValues>;
  errors: FieldErrors<ContractClientFormValues>;
  options: ContractFormOptions;
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
  const staffValues = (watched.staffPageIds ?? []) as string[];
  const dealsForCustomer = customerId
    ? options.deals.filter((d) => d.customerPageId === customerId)
    : [];

  const singleSelect = (
    name:
      | "dealPageId"
      | "contractTypePageId"
      | "tradeTypePageId"
      | "paymentStatusPageId"
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
      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">基本情報</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="契約名" required error={errMsg(errors, "title")}>
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
          <Field label="契約区分">
            {singleSelect("contractTypePageId", options.contractTypes)}
          </Field>
          <Field label="取引区分">
            {singleSelect("tradeTypePageId", options.tradeTypes)}
          </Field>
          <Field label="状態">
            {singleSelect("statusPageId", options.statuses)}
          </Field>
          <Field label="支払状況">
            {singleSelect("paymentStatusPageId", options.paymentStatuses)}
          </Field>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">担当者</h2>
        <Field label="担当者" error={errMsg(errors, "staffPageIds")}>
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
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">金額・日程</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="金額(円)" error={errMsg(errors, "amount")}>
            <input
              type="text"
              inputMode="numeric"
              className={inputCls}
              placeholder="例: 1000000"
              {...register("amount")}
            />
          </Field>
          <Field label="契約日" error={errMsg(errors, "contractedAt")}>
            <input
              type="date"
              className={inputCls}
              {...register("contractedAt")}
            />
          </Field>
          <Field label="開始日" error={errMsg(errors, "startDate")}>
            <input
              type="date"
              className={inputCls}
              {...register("startDate")}
            />
          </Field>
          <Field label="終了日" error={errMsg(errors, "endDate")}>
            <input type="date" className={inputCls} {...register("endDate")} />
          </Field>
          <Field label="自動更新">
            <label className="flex h-7 items-center gap-2 text-xs">
              <input type="checkbox" {...register("autoRenew")} />
              自動更新する
            </label>
          </Field>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold text-slate-700">契約書・備考</h2>
        <div className="grid grid-cols-1 gap-2">
          <Field label="契約書URL" error={errMsg(errors, "contractUrl")}>
            <input
              type="text"
              className={inputCls}
              placeholder="https://"
              {...register("contractUrl")}
            />
          </Field>
          <Field label="請求条件" error={errMsg(errors, "billingTerms")}>
            <textarea
              rows={2}
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-primary focus:outline-none"
              {...register("billingTerms")}
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
