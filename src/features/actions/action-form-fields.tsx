"use client";

import type {
  Control,
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
} from "react-hook-form";
import { useWatch } from "react-hook-form";

import type { ActionClientFormValues } from "@/features/actions/form-schema";
import type { ActionFormOptions } from "@/features/actions/options";

export const inputCls =
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

function errMsg(
  errors: FieldErrors<ActionClientFormValues>,
  key: keyof ActionClientFormValues,
): string | undefined {
  const e = errors[key];
  return typeof e?.message === "string" ? e.message : undefined;
}

export function ActionFormFields({
  register,
  control,
  setValue,
  errors,
  options,
  lockedCustomerPageId,
  lockedDealPageId,
  showActivityField,
}: {
  register: UseFormRegister<ActionClientFormValues>;
  control: Control<ActionClientFormValues>;
  setValue: UseFormSetValue<ActionClientFormValues>;
  errors: FieldErrors<ActionClientFormValues>;
  options: ActionFormOptions;
  lockedCustomerPageId?: string;
  lockedDealPageId?: string;
  showActivityField?: boolean;
}) {
  const watched = useWatch({ control });
  const lockedId = lockedCustomerPageId ?? null;
  const lockedCustomer = lockedId
    ? options.customers.find((c) => c.pageId === lockedId)
    : undefined;

  const customerId =
    typeof watched.customerPageId === "string" ? watched.customerPageId : "";
  const dealsForCustomer = customerId
    ? options.deals.filter((d) => d.customerPageId === customerId)
    : [];
  const activitiesForCustomer = customerId
    ? options.activities.filter((a) => a.customerPageId === customerId)
    : [];

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label="アクション内容"
          required
          error={errMsg(errors, "title")}
          className="md:col-span-2"
        >
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
              </p>
            </>
          ) : (
            <select className={inputCls} {...register("customerPageId")}>
              <option value="">選択してください</option>
              {options.customers.map((c) => (
                <option key={c.pageId} value={c.pageId}>
                  {c.displayName}
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
                typeof watched.dealPageId === "string" ? watched.dealPageId : ""
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

        {showActivityField !== false && (
          <Field label="元対応履歴" error={errMsg(errors, "activityPageId")}>
            <select
              className={inputCls}
              value={
                typeof watched.activityPageId === "string"
                  ? watched.activityPageId
                  : ""
              }
              onChange={(e) =>
                setValue("activityPageId", e.target.value || null, {
                  shouldDirty: true,
                })
              }
              disabled={!customerId}
            >
              <option value="">未選択</option>
              {activitiesForCustomer.map((a) => (
                <option key={a.pageId} value={a.pageId}>
                  {a.title}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="自社担当者" error={errMsg(errors, "staffPageId")}>
          <select
            className={inputCls}
            value={
              typeof watched.staffPageId === "string" ? watched.staffPageId : ""
            }
            onChange={(e) =>
              setValue("staffPageId", e.target.value || null, {
                shouldDirty: true,
              })
            }
          >
            <option value="">未選択</option>
            {options.staff.map((s) => (
              <option key={s.pageId} value={s.pageId}>
                {s.name}
                {!s.isActive ? " (無効)" : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="期限" required error={errMsg(errors, "dueDate")}>
          <input type="date" className={inputCls} {...register("dueDate")} />
        </Field>

        <Field label="状態" required error={errMsg(errors, "statusPageId")}>
          <select className={inputCls} {...register("statusPageId")}>
            <option value="">選択してください</option>
            {options.statuses.map((s) => (
              <option key={s.pageId} value={s.pageId}>
                {s.name}
                {!s.isActive ? " (無効)" : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="優先度" error={errMsg(errors, "priorityPageId")}>
          <select
            className={inputCls}
            value={
              typeof watched.priorityPageId === "string"
                ? watched.priorityPageId
                : ""
            }
            onChange={(e) =>
              setValue("priorityPageId", e.target.value || null, {
                shouldDirty: true,
              })
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

        <Field label="完了日時" error={errMsg(errors, "completedAt")}>
          <input
            type="datetime-local"
            className={inputCls}
            {...register("completedAt")}
          />
        </Field>
      </div>
      <p className="text-[10px] text-slate-400">
        先方担当者フィールドはありません。顧客・案件・元対応履歴で関連付けます。
      </p>
    </div>
  );
}
