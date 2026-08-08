"use client";

import type {
  Control,
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
} from "react-hook-form";
import { useWatch } from "react-hook-form";

import type { ActivityClientFormValues } from "@/features/activities/form-schema";
import type { ActivityFormOptions } from "@/features/activities/options";

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

function MultiCheck({
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
  errors: FieldErrors<ActivityClientFormValues>,
  key: keyof ActivityClientFormValues,
): string | undefined {
  const e = errors[key];
  return typeof e?.message === "string" ? e.message : undefined;
}

export function ActivityFormFields({
  register,
  control,
  setValue,
  errors,
  options,
  lockedCustomerPageId,
  lockedDealPageId,
  lockedContactPageId,
  showNextActionOption,
  mode,
}: {
  register: UseFormRegister<ActivityClientFormValues>;
  control: Control<ActivityClientFormValues>;
  setValue: UseFormSetValue<ActivityClientFormValues>;
  errors: FieldErrors<ActivityClientFormValues>;
  options: ActivityFormOptions;
  lockedCustomerPageId?: string;
  lockedDealPageId?: string;
  lockedContactPageId?: string;
  showNextActionOption?: boolean;
  mode: "create" | "edit";
}) {
  const watched = useWatch({ control });
  const lockedId = lockedCustomerPageId ?? null;
  const lockedCustomer = lockedId
    ? options.customers.find((c) => c.pageId === lockedId)
    : undefined;

  const customerId =
    typeof watched.customerPageId === "string" ? watched.customerPageId : "";
  const contactValues = (watched.contactPageIds ?? []) as string[];
  const categoryValues = (watched.categoryPageIds ?? []) as string[];
  const createNext = Boolean(watched.createNextAction);

  const contactsForCustomer = customerId
    ? options.contacts.filter((c) => c.customerPageId === customerId)
    : [];
  const dealsForCustomer = customerId
    ? options.deals.filter((d) => d.customerPageId === customerId)
    : [];

  const toggleMulti = (name: "contactPageIds" | "categoryPageIds", id: string) => {
    const current =
      name === "contactPageIds" ? contactValues : categoryValues;
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    setValue(name, next, { shouldDirty: true });
  };

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="タイトル" required error={errMsg(errors, "title")}>
          <input className={inputCls} {...register("title")} />
        </Field>

        <Field
          label="組織"
          required
          error={errMsg(errors, "customerPageId")}
        >
          {lockedId ? (
            <>
              <input type="hidden" {...register("customerPageId")} />
              <p className="h-7 leading-7 text-xs text-slate-800">
                {lockedCustomer?.displayName ?? "(組織)"}
                {lockedCustomer?.isArchived && (
                  <span className="ml-1 rounded bg-slate-200 px-1 text-[10px]">
                    アーカイブ
                  </span>
                )}
              </p>
            </>
          ) : (
            <select className={inputCls} {...register("customerPageId")}>
              <option value="">選択してください</option>
              {options.customers.map((c) => (
                <option key={c.pageId} value={c.pageId}>
                  {c.displayName}
                  {c.isArchived ? " (アーカイブ)" : ""}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="関連案件" error={errMsg(errors, "dealPageId")}>
          {lockedDealPageId ? (
            <>
              <input type="hidden" {...register("dealPageId")} />
              <p className="h-7 leading-7 text-xs text-slate-800">
                {options.deals.find((d) => d.pageId === lockedDealPageId)
                  ?.title ?? "(案件)"}
              </p>
            </>
          ) : (
            <select
              className={inputCls}
              value={
                typeof watched.dealPageId === "string"
                  ? watched.dealPageId
                  : ""
              }
              onChange={(e) =>
                setValue("dealPageId", e.target.value || null, {
                  shouldDirty: true,
                })
              }
              disabled={!customerId}
            >
              <option value="">未選択</option>
              {dealsForCustomer.map((d) => (
                <option key={d.pageId} value={d.pageId}>
                  {d.title}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="対応日時" required error={errMsg(errors, "activityAt")}>
          <input
            type="datetime-local"
            className={inputCls}
            {...register("activityAt")}
          />
        </Field>
      </div>

      <Field label="顧客担当者">
        {lockedContactPageId ? (
          <p className="text-xs text-slate-800">
            {options.contacts.find((c) => c.pageId === lockedContactPageId)
              ?.name ?? "(担当者)"}
          </p>
        ) : (
          <MultiCheck
            options={contactsForCustomer.map((c) => ({
              id: c.pageId,
              label: c.name,
              inactive: !c.isActive,
            }))}
            values={contactValues}
            onToggle={(id) => toggleMulti("contactPageIds", id)}
            emptyText="この顧客の担当者はありません"
            disabled={!customerId}
          />
        )}
      </Field>

      <Field label="対応分類">
        <MultiCheck
          options={options.categories.map((c) => ({
            id: c.pageId,
            label: c.name,
            inactive: !c.isActive,
          }))}
          values={categoryValues}
          onToggle={(id) => toggleMulti("categoryPageIds", id)}
          emptyText="分類マスタがありません"
        />
      </Field>

      <Field label="要約" error={errMsg(errors, "summary")}>
        <input
          className={inputCls}
          placeholder="空欄なら本文先頭から自動生成"
          {...register("summary")}
        />
      </Field>

      <Field label="本文" error={errMsg(errors, "body")}>
        <textarea
          className="min-h-32 w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
          {...register("body")}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label="次回アクション(入力記録)"
          error={errMsg(errors, "nextActionNote")}
        >
          <input className={inputCls} {...register("nextActionNote")} />
        </Field>
        <Field
          label="次回予定日(入力記録)"
          error={errMsg(errors, "nextActionDate")}
        >
          <input
            type="date"
            className={inputCls}
            {...register("nextActionDate")}
          />
        </Field>
      </div>
      <p className="text-[10px] text-slate-400">
        入力記録は履歴のスナップショットです。正本の次回アクションは別途登録されます。
      </p>

      {mode === "create" && showNextActionOption && (
        <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={createNext}
              onChange={(e) =>
                setValue("createNextAction", e.target.checked, {
                  shouldDirty: true,
                })
              }
            />
            続けて次回アクションを登録
          </label>
          {createNext && (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Field
                label="アクション内容"
                required
                error={errMsg(errors, "nextActionTitle")}
              >
                <input className={inputCls} {...register("nextActionTitle")} />
              </Field>
              <Field
                label="期限"
                required
                error={errMsg(errors, "nextActionDueDate")}
              >
                <input
                  type="date"
                  className={inputCls}
                  {...register("nextActionDueDate")}
                />
              </Field>
              <Field label="自社担当者">
                <select
                  className={inputCls}
                  value={
                    typeof watched.nextActionStaffPageId === "string"
                      ? watched.nextActionStaffPageId
                      : ""
                  }
                  onChange={(e) =>
                    setValue(
                      "nextActionStaffPageId",
                      e.target.value || null,
                      { shouldDirty: true },
                    )
                  }
                >
                  <option value="">未選択</option>
                  {options.staff.map((s) => (
                    <option key={s.pageId} value={s.pageId}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="優先度">
                <select
                  className={inputCls}
                  value={
                    typeof watched.nextActionPriorityPageId === "string"
                      ? watched.nextActionPriorityPageId
                      : ""
                  }
                  onChange={(e) =>
                    setValue(
                      "nextActionPriorityPageId",
                      e.target.value || null,
                      { shouldDirty: true },
                    )
                  }
                >
                  <option value="">未選択</option>
                  {options.priorities.map((p) => (
                    <option key={p.pageId} value={p.pageId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
