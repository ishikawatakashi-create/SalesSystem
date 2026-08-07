"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  createContractAction,
  updateContractAction,
  type ContractActionResult,
} from "@/features/contracts/actions";
import { ContractFormFields } from "@/features/contracts/contract-form-fields";
import {
  contractClientFormSchema,
  toContractFormDefaults,
  type ContractClientFormParsed,
  type ContractClientFormValues,
} from "@/features/contracts/form-schema";
import type { ContractFormOptions } from "@/features/contracts/options";

export type ContractFormInitial = Parameters<typeof toContractFormDefaults>[0];

export type ContractFormMeta =
  | { mode: "create"; successRedirect?: string }
  | {
      mode: "edit";
      notionPageId: string;
      externalId: string;
      lastEditedTime: string;
      successRedirect?: string;
    };

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

export function ContractForm({
  meta,
  options,
  initial,
  lockedCustomerPageId,
  lockedDealPageId,
}: {
  meta: ContractFormMeta;
  options: ContractFormOptions;
  initial?: ContractFormInitial;
  lockedCustomerPageId?: string;
  lockedDealPageId?: string;
}) {
  const router = useRouter();
  const [requestId, setRequestId] = useState<string>(() => newId());
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const lockedId = lockedCustomerPageId ?? null;

  const defaults = useMemo(() => {
    const base = toContractFormDefaults(initial, lockedId);
    if (lockedDealPageId) {
      base.dealPageId = lockedDealPageId;
    }
    return base;
  }, [initial, lockedId, lockedDealPageId]);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ContractClientFormValues, unknown, ContractClientFormParsed>({
    resolver: zodResolver(contractClientFormSchema),
    defaultValues: defaults,
  });

  const watchedDealPageId = useWatch({ control, name: "dealPageId" });

  const onCustomerChange = (nextCustomerId: string) => {
    setValue("customerPageId", nextCustomerId, { shouldDirty: true });
    // 顧客変更時は所属外案件をクリア
    if (watchedDealPageId) {
      const deal = options.deals.find((d) => d.pageId === watchedDealPageId);
      if (!deal || deal.customerPageId !== nextCustomerId) {
        setValue("dealPageId", null, { shouldDirty: true });
      }
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setConflict(false);

    const payload = {
      ...values,
      customerPageId: lockedId ?? values.customerPageId,
      dealPageId: lockedDealPageId ?? values.dealPageId,
    };

    let result: ContractActionResult;
    if (meta.mode === "create") {
      result = await createContractAction({ requestId, data: payload });
    } else {
      result = await updateContractAction({
        requestId,
        notionPageId: meta.notionPageId,
        externalId: meta.externalId,
        expectedLastEditedTime: meta.lastEditedTime,
        data: payload,
      });
    }

    if (result.ok) {
      const dest =
        meta.successRedirect ?? `/contracts/${result.notionPageId}?saved=1`;
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

      <ContractFormFields
        register={register}
        control={control}
        setValue={setValue}
        errors={errors}
        options={options}
        lockedCustomerPageId={lockedId ?? undefined}
        lockedDealPageId={lockedDealPageId}
        onCustomerChange={onCustomerChange}
      />

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
