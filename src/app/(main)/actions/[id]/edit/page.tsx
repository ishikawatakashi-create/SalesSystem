import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getActionDetail } from "@/lib/actions/read-detail";
import type { ActionDetail } from "@/lib/actions/types";
import { isActionSyncError } from "@/lib/sync/errors";
import { ActionForm } from "@/features/actions/action-form";
import { loadActionFormOptions } from "@/features/actions/options";
import { toDatetimeLocalValue } from "@/features/activities/format";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ActionEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "action.edit")) {
      redirect("/actions");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  if (!PAGE_ID_RE.test(id)) notFound();

  let detail: ActionDetail;
  try {
    detail = await getActionDetail({ notionPageId: id, skipCache: true });
  } catch (error) {
    if (isActionSyncError(error)) {
      if (error.code === "not_found") notFound();
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <p className="text-sm font-medium text-slate-900">
            Notionへの接続に失敗しました
          </p>
          <p className="mt-1 text-xs text-slate-500">
            編集を開始できません。通信状態を確認のうえ再試行してください。
          </p>
          <div className="mt-4 flex items-center justify-center gap-3 text-xs">
            <a
              href={`/actions/${id}/edit`}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 hover:bg-slate-50"
            >
              再試行
            </a>
            <Link
              href={`/actions/${id}`}
              className="text-slate-500 hover:text-slate-900"
            >
              詳細へ戻る
            </Link>
          </div>
        </div>
      );
    }
    throw error;
  }

  const options = await loadActionFormOptions({
    currentCustomerPageId: detail.customerPageId ?? undefined,
    currentDealPageId: detail.dealPageId ?? undefined,
    currentActivityPageId: detail.activityPageId ?? undefined,
    currentStaffPageId: detail.staffPageId ?? undefined,
    currentStatusPageId: detail.statusPageId ?? undefined,
    currentPriorityPageId: detail.priorityPageId ?? undefined,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">
          次回アクション編集: {detail.title || "(無題)"}
        </h1>
        <Link
          href={`/actions/${detail.notionPageId}`}
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          詳細へ戻る
        </Link>
      </div>
      <ActionForm
        meta={{
          mode: "edit",
          notionPageId: detail.notionPageId,
          externalId: detail.externalId,
          lastEditedTime: detail.lastEditedTime,
        }}
        options={options}
        initial={{
          title: detail.title,
          customerPageId: detail.customerPageId,
          dealPageId: detail.dealPageId,
          activityPageId: detail.activityPageId,
          staffPageId: detail.staffPageId,
          dueDate: detail.dueDate,
          statusPageId: detail.statusPageId,
          priorityPageId: detail.priorityPageId,
          completedAt: toDatetimeLocalValue(detail.completedAt) || detail.completedAt,
        }}
      />
    </div>
  );
}
