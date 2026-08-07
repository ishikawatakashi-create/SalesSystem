"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  createActionAction,
  updateActionAction,
  type ActionActionResult,
} from "@/features/actions/actions";
import { ActionFormFields } from "@/features/actions/action-form-fields";
import {
  actionClientFormSchema,
  toActionFormDefaults,
  type ActionClientFormParsed,
  type ActionClientFormValues,
} from "@/features/actions/form-schema";
import type { ActionFormOptions } from "@/features/actions/options";

export type ActionFormInitial = Parameters<typeof toActionFormDefaults>[0];

export type ActionFormMeta =
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

export function ActionForm({
  meta,
  options,
  initial,
  lockedCustomerPageId,
  lockedDealPageId,
  showActivityField,
}: {
  meta: ActionFormMeta;
  options: ActionFormOptions;
  initial?: ActionFormInitial;
  lockedCustomerPageId?: string;
  lockedDealPageId?: string;
  showActivityField?: boolean;
}) {
  const router = useRouter();
  const [requestId, setRequestId] = useState<string>(() => newId());
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const lockedId = lockedCustomerPageId ?? null;

  const defaults = useMemo(() => {
    const base = toActionFormDefaults(
      initial,
      lockedId,
      options.defaultOpenStatusPageId,
    );
    if (lockedDealPageId) base.dealPageId = lockedDealPageId;
    return base;
  }, [initial, lockedId, lockedDealPageId, options.defaultOpenStatusPageId]);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ActionClientFormValues, unknown, ActionClientFormParsed>({
    resolver: zodResolver(actionClientFormSchema),
    defaultValues: defaults,
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setConflict(false);

    const payload = {
      ...values,
      customerPageId: lockedId ?? values.customerPageId,
      dealPageId: lockedDealPageId ?? values.dealPageId,
      completedAt: values.completedAt || null,
    };

    let result: ActionActionResult;
    if (meta.mode === "create") {
      result = await createActionAction({ requestId, data: payload });
    } else {
      result = await updateActionAction({
        requestId,
        notionPageId: meta.notionPageId,
        externalId: meta.externalId,
        expectedLastEditedTime: meta.lastEditedTime,
        data: payload,
      });
    }

    if (result.ok) {
      const dest =
        meta.successRedirect ?? `/actions/${result.notionPageId}?saved=1`;
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

      <ActionFormFields
        register={register}
        control={control}
        setValue={setValue}
        errors={errors}
        options={options}
        lockedCustomerPageId={lockedId ?? undefined}
        lockedDealPageId={lockedDealPageId}
        showActivityField={showActivityField}
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
