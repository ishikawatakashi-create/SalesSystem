"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  createDealAction,
  updateDealAction,
  type DealActionResult,
} from "@/features/deals/actions";
import { DealFormFields } from "@/features/deals/deal-form-fields";
import {
  dealClientFormSchema,
  toDealFormDefaults,
  type DealClientFormParsed,
  type DealClientFormValues,
} from "@/features/deals/form-schema";
import type { DealFormOptions } from "@/features/deals/options";

export type DealFormInitial = Parameters<typeof toDealFormDefaults>[0];

export type DealFormMeta =
  | { mode: "create"; successRedirect?: string }
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

function findIncompatibleContacts(
  contactPageIds: string[],
  customerPageId: string,
  options: DealFormOptions,
): { ids: string[]; names: string[] } {
  if (!customerPageId || contactPageIds.length === 0) {
    return { ids: [], names: [] };
  }
  const ids: string[] = [];
  const names: string[] = [];
  for (const id of contactPageIds) {
    const c = options.contacts.find((x) => x.pageId === id);
    if (!c || c.customerPageId !== customerPageId) {
      ids.push(id);
      names.push(c?.name ?? "(不明)");
    }
  }
  return { ids, names };
}

export function DealForm({
  meta,
  options,
  initial,
  lockedCustomerPageId,
}: {
  meta: DealFormMeta;
  options: DealFormOptions;
  initial?: DealFormInitial;
  /** 顧客詳細からの新規時など。値は送信し、UIは読取専用表示 */
  lockedCustomerPageId?: string;
}) {
  const router = useRouter();
  const [requestId, setRequestId] = useState<string>(() => newId());
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const lockedId = lockedCustomerPageId ?? null;

  const defaults = useMemo(
    () => toDealFormDefaults(initial, lockedId),
    [initial, lockedId],
  );

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<DealClientFormValues, unknown, DealClientFormParsed>({
    resolver: zodResolver(dealClientFormSchema),
    defaultValues: defaults,
  });

  const watchedCustomer = useWatch({ control, name: "customerPageId" });
  const watchedContacts = useWatch({ control, name: "contactPageIds" });
  const customerId =
    typeof watchedCustomer === "string" ? watchedCustomer : "";
  const contactIds = (watchedContacts ?? []) as string[];
  const mismatch = findIncompatibleContacts(contactIds, customerId, options);
  const hasMismatch = mismatch.ids.length > 0;

  const onCustomerChange = (nextCustomerId: string) => {
    setValue("customerPageId", nextCustomerId, { shouldDirty: true });
    // 所属外の担当者は残し、警告表示+送信ブロックで明示する(サイレント維持しない)
  };

  const onClearIncompatibleContacts = () => {
    const keep = contactIds.filter((id) => !mismatch.ids.includes(id));
    setValue("contactPageIds", keep, { shouldDirty: true });
  };

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setConflict(false);

    const payloadCustomerId = lockedId ?? values.customerPageId;
    const mismatchOnSubmit = findIncompatibleContacts(
      values.contactPageIds ?? [],
      payloadCustomerId,
      options,
    );
    if (mismatchOnSubmit.ids.length > 0) {
      setServerError(
        "選択中の顧客担当者が現在の顧客に所属していません。解除してから保存してください",
      );
      return;
    }

    const payload = {
      ...values,
      customerPageId: payloadCustomerId,
    };

    let result: DealActionResult;
    if (meta.mode === "create") {
      result = await createDealAction({ requestId, data: payload });
    } else {
      result = await updateDealAction({
        requestId,
        notionPageId: meta.notionPageId,
        externalId: meta.externalId,
        expectedLastEditedTime: meta.lastEditedTime,
        data: payload,
      });
    }

    if (result.ok) {
      const dest =
        meta.successRedirect ??
        `/deals/${result.notionPageId}?saved=1`;
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

      <DealFormFields
        register={register}
        control={control}
        setValue={setValue}
        errors={errors}
        options={options}
        lockedCustomerPageId={lockedId ?? undefined}
        contactMismatch={hasMismatch ? mismatch : null}
        onCustomerChange={onCustomerChange}
        onClearIncompatibleContacts={onClearIncompatibleContacts}
      />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting || conflict || hasMismatch}
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
