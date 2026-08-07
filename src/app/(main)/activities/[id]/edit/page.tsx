import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getActivityDetail } from "@/lib/activities/read-detail";
import type { ActivityDetail } from "@/lib/activities/types";
import { isActivitySyncError } from "@/lib/sync/errors";
import { ActivityForm } from "@/features/activities/activity-form";
import { toDatetimeLocalValue } from "@/features/activities/format";
import { loadActivityFormOptions } from "@/features/activities/options";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ActivityEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "activity.edit")) {
      redirect("/activities");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  if (!PAGE_ID_RE.test(id)) notFound();

  let detail: ActivityDetail;
  try {
    detail = await getActivityDetail({ notionPageId: id, skipCache: true });
  } catch (error) {
    if (isActivitySyncError(error)) {
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
              href={`/activities/${id}/edit`}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 hover:bg-slate-50"
            >
              再試行
            </a>
            <Link
              href={`/activities/${id}`}
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

  const options = await loadActivityFormOptions({
    currentCustomerPageId: detail.customerPageId ?? undefined,
    currentContactPageIds: detail.contactPageIds,
    currentDealPageId: detail.dealPageId ?? undefined,
    currentCategoryPageIds: detail.categoryPageIds,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">
          対応履歴編集: {detail.title || "(無題)"}
        </h1>
        <Link
          href={`/activities/${detail.notionPageId}`}
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          詳細へ戻る
        </Link>
      </div>
      <ActivityForm
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
          contactPageIds: detail.contactPageIds,
          activityAt: toDatetimeLocalValue(detail.activityAt),
          categoryPageIds: detail.categoryPageIds,
          summary: detail.summary,
          nextActionNote: detail.nextActionNote,
          nextActionDate: detail.nextActionDate,
          body: detail.body,
        }}
      />
    </div>
  );
}
