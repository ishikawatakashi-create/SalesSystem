import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getDealDetail } from "@/lib/deals/read-detail";
import type { DealDetail } from "@/lib/deals/types";
import { isDealSyncError } from "@/lib/sync/errors";
import { DealForm } from "@/features/deals/deal-form";
import { loadDealFormOptions } from "@/features/deals/options";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DealEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "deal.edit")) {
      redirect("/deals");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  if (!PAGE_ID_RE.test(id)) notFound();

  let detail: DealDetail;
  try {
    detail = await getDealDetail({ notionPageId: id, skipCache: true });
  } catch (error) {
    if (isDealSyncError(error)) {
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
              href={`/deals/${id}/edit`}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 hover:bg-slate-50"
            >
              再試行
            </a>
            <Link
              href={`/deals/${id}`}
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

  const options = await loadDealFormOptions({
    currentCustomerPageId: detail.customerPageId ?? undefined,
    currentContactPageIds: detail.contactPageIds,
    currentBusinessCategoryPageId:
      detail.businessCategoryPageId ?? undefined,
    currentStagePageId: detail.stagePageId ?? undefined,
    currentStatusPageId: detail.statusPageId ?? undefined,
    currentStaffPageIds: detail.staffPageIds,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <Breadcrumbs
        items={[
          { label: "案件一覧", href: "/deals" },
          {
            label: detail.title || "(無題)",
            href: `/deals/${detail.notionPageId}`,
          },
          { label: "編集" },
        ]}
      />
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">
          案件編集: {detail.title || "(無題)"}
        </h1>
        <Link
          href={`/deals/${detail.notionPageId}`}
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          詳細へ戻る
        </Link>
      </div>
      <DealForm
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
          contactPageIds: detail.contactPageIds,
          businessCategoryPageId: detail.businessCategoryPageId,
          productName: detail.productName,
          stagePageId: detail.stagePageId,
          staffPageIds: detail.staffPageIds,
          expectedAmount: detail.expectedAmount,
          contractAmount: detail.contractAmount,
          probability: detail.probability,
          expectedCloseDate: detail.expectedCloseDate,
          contractedAt: detail.contractedAt,
          periodStart: detail.periodStart,
          periodEnd: detail.periodEnd,
          lostReason: detail.lostReason,
          statusPageId: detail.statusPageId,
          note: detail.note,
        }}
      />
    </div>
  );
}
