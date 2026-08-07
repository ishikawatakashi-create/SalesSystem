import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getComplaintDetail } from "@/lib/complaints/read-detail";
import type { ComplaintDetail } from "@/lib/complaints/types";
import { isComplaintSyncError } from "@/lib/sync/errors";
import { ComplaintForm } from "@/features/complaints/complaint-form";
import { loadComplaintFormOptions } from "@/features/complaints/options";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ComplaintEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "complaint.edit")) {
      redirect("/complaints");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  if (!PAGE_ID_RE.test(id)) notFound();

  let detail: ComplaintDetail;
  try {
    detail = await getComplaintDetail({ notionPageId: id, skipCache: true });
  } catch (error) {
    if (isComplaintSyncError(error)) {
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
              href={`/complaints/${id}/edit`}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 hover:bg-slate-50"
            >
              再試行
            </a>
            <Link
              href={`/complaints/${id}`}
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

  const options = await loadComplaintFormOptions({
    currentCustomerPageId: detail.customerPageId ?? undefined,
    currentDealPageId: detail.dealPageId ?? undefined,
    currentSeverityPageId: detail.severityPageId ?? undefined,
    currentStatusPageId: detail.statusPageId ?? undefined,
    currentStaffPageId: detail.staffPageId ?? undefined,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <Breadcrumbs
        items={[
          { label: "クレーム一覧", href: "/complaints" },
          {
            label: detail.title || "(無題)",
            href: `/complaints/${detail.notionPageId}`,
          },
          { label: "編集" },
        ]}
      />
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">
          クレーム編集: {detail.title || "(無題)"}
        </h1>
        <Link
          href={`/complaints/${detail.notionPageId}`}
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          詳細へ戻る
        </Link>
      </div>
      <ComplaintForm
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
          severityPageId: detail.severityPageId,
          statusPageId: detail.statusPageId,
          staffPageId: detail.staffPageId,
          occurredOn: detail.occurredOn,
          summary: detail.summary,
          dueDate: detail.dueDate,
          completedOn: detail.completedOn,
          note: detail.note,
          content: detail.content,
          cause: detail.cause,
          response: detail.response,
          prevention: detail.prevention,
        }}
      />
    </div>
  );
}
