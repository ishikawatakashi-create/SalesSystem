"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  createActivityAction,
  createActivityWithNextActionAction,
  retryNextActionAfterActivityAction,
  updateActivityAction,
  type ActivityActionResult,
  type ActivityWithNextActionResult,
} from "@/features/activities/actions";
import { ActivityFormFields } from "@/features/activities/activity-form-fields";
import {
  activityClientFormSchema,
  toActivityFormDefaults,
  type ActivityClientFormParsed,
  type ActivityClientFormValues,
} from "@/features/activities/form-schema";
import { fromDatetimeLocalValue } from "@/features/activities/format";
import type { ActivityFormOptions } from "@/features/activities/options";

export type ActivityFormInitial = Parameters<typeof toActivityFormDefaults>[0];

export type ActivityFormMeta =
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

export function ActivityForm({
  meta,
  options,
  initial,
  lockedCustomerPageId,
  lockedDealPageId,
  lockedContactPageId,
}: {
  meta: ActivityFormMeta;
  options: ActivityFormOptions;
  initial?: ActivityFormInitial;
  lockedCustomerPageId?: string;
  lockedDealPageId?: string;
  lockedContactPageId?: string;
}) {
  const router = useRouter();
  const [requestId, setRequestId] = useState<string>(() => newId());
  const [actionRequestId, setActionRequestId] = useState<string>(() =>
    newId(),
  );
  const [correlationId] = useState<string>(() => newId());
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [partial, setPartial] = useState<{
    activityPageId: string;
    warning: string;
    actionRequestId: string;
    customerPageId: string;
    dealPageId: string | null;
    nextAction: {
      title: string;
      dueDate: string;
      staffPageId: string | null;
      priorityPageId: string | null;
    };
  } | null>(null);

  const lockedId = lockedCustomerPageId ?? null;

  const defaults = useMemo(() => {
    const base = toActivityFormDefaults(initial, lockedId);
    if (lockedDealPageId) {
      base.dealPageId = lockedDealPageId;
    }
    if (lockedContactPageId) {
      base.contactPageIds = [lockedContactPageId];
    }
    return base;
  }, [initial, lockedId, lockedDealPageId, lockedContactPageId]);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ActivityClientFormValues, unknown, ActivityClientFormParsed>({
    resolver: zodResolver(activityClientFormSchema),
    defaultValues: defaults,
  });

  const buildActivityPayload = (values: ActivityClientFormParsed) => {
    const activityAt = fromDatetimeLocalValue(values.activityAt);
    return {
      title: values.title,
      customerPageId: lockedId ?? values.customerPageId,
      dealPageId: lockedDealPageId ?? values.dealPageId,
      contactPageIds: lockedContactPageId
        ? [lockedContactPageId]
        : (values.contactPageIds ?? []),
      activityAt,
      categoryPageIds: values.categoryPageIds ?? [],
      summary: values.summary,
      nextActionNote: values.nextActionNote,
      nextActionDate: values.nextActionDate,
      body: values.body,
      batchId: null,
    };
  };

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setConflict(false);

    if (values.createNextAction) {
      if (!values.nextActionTitle?.trim()) {
        setServerError("次回アクションの内容を入力してください");
        return;
      }
      if (!values.nextActionDueDate) {
        setServerError("次回アクションの期限を入力してください");
        return;
      }
    }

    const payload = buildActivityPayload(values);

    if (meta.mode === "edit") {
      const result: ActivityActionResult = await updateActivityAction({
        requestId,
        notionPageId: meta.notionPageId,
        externalId: meta.externalId,
        expectedLastEditedTime: meta.lastEditedTime,
        data: payload,
      });
      if (result.ok) {
        const dest =
          meta.successRedirect ??
          `/activities/${result.notionPageId}?saved=1`;
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
      return;
    }

    if (values.createNextAction) {
      const nextAction = {
        title: values.nextActionTitle!.trim(),
        dueDate: values.nextActionDueDate!,
        staffPageId: values.nextActionStaffPageId ?? null,
        priorityPageId: values.nextActionPriorityPageId ?? null,
      };
      const result: ActivityWithNextActionResult =
        await createActivityWithNextActionAction({
          correlationId,
          activityRequestId: requestId,
          actionRequestId,
          activityData: payload,
          nextAction,
        });

      if (result.ok && !result.partialFailure) {
        const dest =
          meta.successRedirect ??
          `/activities/${result.activityPageId}?saved=1`;
        router.push(dest);
        router.refresh();
        return;
      }
      if (result.ok && result.partialFailure && result.canRetryAction) {
        setPartial({
          activityPageId: result.activityPageId,
          warning:
            result.warning ??
            "対応履歴は保存しましたが、次回アクションの登録に失敗しました",
          actionRequestId: result.actionRequestId ?? actionRequestId,
          customerPageId: payload.customerPageId,
          dealPageId:
            typeof payload.dealPageId === "string" ? payload.dealPageId : null,
          nextAction,
        });
        return;
      }
      if (!result.ok) {
        setServerError(result.message);
        if (result.reason && REGENERATE_REASONS.has(result.reason)) {
          setRequestId(newId());
          setActionRequestId(newId());
        }
      }
      return;
    }

    const result = await createActivityAction({ requestId, data: payload });
    if (result.ok) {
      const dest =
        meta.successRedirect ?? `/activities/${result.notionPageId}?saved=1`;
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

  const onRetryAction = async () => {
    if (!partial) return;
    setServerError(null);
    const result = await retryNextActionAfterActivityAction({
      correlationId,
      actionRequestId: partial.actionRequestId,
      activityPageId: partial.activityPageId,
      customerPageId: partial.customerPageId,
      dealPageId: partial.dealPageId,
      nextAction: partial.nextAction,
    });
    if (result.ok && result.actionPageId) {
      const dest =
        meta.mode === "create" && meta.successRedirect
          ? meta.successRedirect
          : `/activities/${partial.activityPageId}?saved=1&action=1`;
      router.push(dest);
      router.refresh();
      return;
    }
    setServerError(
      result.ok
        ? (result.warning ?? "次回アクションの登録に失敗しました")
        : result.message,
    );
    // 失敗時のみ action request_id を再発行(履歴側は触らない)
    const nextActionReq = newId();
    setActionRequestId(nextActionReq);
    setPartial({ ...partial, actionRequestId: nextActionReq });
  };

  if (partial) {
    return (
      <div className="space-y-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        <p className="font-medium">対応履歴は保存済みです(部分成功)</p>
        <p>{partial.warning}</p>
        <p className="text-slate-600">
          次回アクションのみ再試行できます。対応履歴の再送信は行いません。
        </p>
        {serverError && (
          <p className="rounded border border-red-300 bg-red-50 p-2 text-red-800">
            {serverError}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRetryAction}
            className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover"
          >
            次回アクションのみ再試行
          </button>
          <button
            type="button"
            onClick={() => {
              router.push(`/activities/${partial.activityPageId}`);
              router.refresh();
            }}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
          >
            対応履歴詳細へ
          </button>
        </div>
      </div>
    );
  }

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

      <ActivityFormFields
        register={register}
        control={control}
        setValue={setValue}
        errors={errors}
        options={options}
        lockedCustomerPageId={lockedId ?? undefined}
        lockedDealPageId={lockedDealPageId}
        lockedContactPageId={lockedContactPageId}
        showNextActionOption={meta.mode === "create"}
        mode={meta.mode}
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
