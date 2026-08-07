import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getDealDetail } from "@/lib/deals/read-detail";
import type { DealDetail } from "@/lib/deals/types";
import { listActivities } from "@/lib/activities/read-list";
import { listActions } from "@/lib/actions/read-list";
import { listContractsByDeal } from "@/lib/contracts/read-list";
import { listComplaintsByDeal } from "@/lib/complaints/read-list";
import { isDealSyncError } from "@/lib/sync/errors";
import { DealDetailView } from "@/features/deals/deal-detail-view";
import { loadDetailLabelMaps } from "@/features/deals/list-data";
import { DealRelatedSection } from "@/features/activities/deal-related-section";
import { loadListLabelMaps as loadActivityListLabelMaps } from "@/features/activities/list-data";
import { loadListLabelMaps as loadActionListLabelMaps } from "@/features/actions/list-data";
import { DealContractsSection } from "@/features/contracts/deal-related-section";
import { loadListLabelMaps as loadContractListLabelMaps } from "@/features/contracts/list-data";
import { DealComplaintsSection } from "@/features/complaints/deal-related-section";
import { loadListLabelMaps as loadComplaintListLabelMaps } from "@/features/complaints/list-data";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export default async function DealDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawParams>;
}) {
  let canEdit = false;
  let canEditActivity = false;
  let canEditAction = false;
  let canEditContract = false;
  let canEditComplaint = false;
  try {
    const user = await requireUser();
    canEdit = hasPermission(user.role, "deal.edit");
    canEditActivity = hasPermission(user.role, "activity.edit");
    canEditAction = hasPermission(user.role, "action.edit");
    canEditContract = hasPermission(user.role, "contract.edit");
    canEditComplaint = hasPermission(user.role, "complaint.edit");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  const rawSearch = await searchParams;
  const savedNote = str(rawSearch, "saved") === "1";
  if (!PAGE_ID_RE.test(id)) notFound();

  let detail: DealDetail;
  try {
    detail = await getDealDetail({ notionPageId: id });
  } catch (error) {
    if (isDealSyncError(error)) {
      if (error.code === "not_found") notFound();
      if (error.code === "in_trash") {
        return (
          <div className="mx-auto max-w-md py-16 text-center text-sm text-slate-600">
            この案件はNotionのゴミ箱にあります。
            <div className="mt-3">
              <Link href="/deals" className="text-xs text-primary underline">
                一覧へ戻る
              </Link>
            </div>
          </div>
        );
      }
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <p className="text-sm font-medium text-slate-900">
            Notionへの接続に失敗しました
          </p>
          <p className="mt-1 text-xs text-slate-500">
            正本データを取得できないため、この画面ではキャッシュを表示しません。
            通信状態を確認のうえ再試行してください。
          </p>
          <div className="mt-4 flex items-center justify-center gap-3 text-xs">
            <a
              href={`/deals/${id}`}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 hover:bg-slate-50"
            >
              再試行
            </a>
            <Link href="/deals" className="text-slate-500 hover:text-slate-900">
              一覧へ戻る
            </Link>
          </div>
        </div>
      );
    }
    throw error;
  }

  const labels = await loadDetailLabelMaps(detail);
  const [activitiesResult, actionsResult, contracts, complaints] =
    await Promise.all([
      listActivities({
        dealPageId: detail.notionPageId,
        sort: "activity_at",
        sortDir: "desc",
        limit: 50,
      }),
      listActions({
        dealPageId: detail.notionPageId,
        sort: "due_date",
        sortDir: "asc",
        limit: 50,
      }),
      listContractsByDeal(detail.notionPageId),
      listComplaintsByDeal(detail.notionPageId),
    ]);
  const [activityLabels, actionLabels, contractLabels, complaintLabels] =
    await Promise.all([
      loadActivityListLabelMaps(activitiesResult.rows),
      loadActionListLabelMaps(actionsResult.rows),
      loadContractListLabelMaps(contracts),
      loadComplaintListLabelMaps(complaints),
    ]);

  return (
    <div className="space-y-3">
      <DealDetailView
        detail={detail}
        labels={labels}
        canEdit={canEdit}
        savedNote={savedNote}
      />
      <div className="mx-auto max-w-4xl space-y-3">
        <DealRelatedSection
          dealPageId={detail.notionPageId}
          customerPageId={detail.customerPageId}
          activities={activitiesResult.rows}
          activityLabels={activityLabels}
          actions={actionsResult.rows}
          actionLabels={actionLabels}
          canEditActivity={canEditActivity}
          canEditAction={canEditAction}
          derivedNext={{
            nextAction: detail.nextAction,
            nextActionDate: detail.nextActionDate,
          }}
        />
        <DealContractsSection
          dealPageId={detail.notionPageId}
          customerPageId={detail.customerPageId}
          contracts={contracts}
          labels={contractLabels}
          canEdit={canEditContract}
        />
        <DealComplaintsSection
          dealPageId={detail.notionPageId}
          customerPageId={detail.customerPageId}
          complaints={complaints}
          labels={complaintLabels}
          canEdit={canEditComplaint}
        />
      </div>
    </div>
  );
}
