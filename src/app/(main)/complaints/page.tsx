import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/require";
import { listComplaints } from "@/lib/complaints/read-list";
import {
  COMPLAINT_LIST_PER_PAGE,
  buildComplaintListSearch,
  parseComplaintListParams,
} from "@/lib/complaints/list-params";
import {
  loadListFilterOptions,
  loadListLabelMaps,
} from "@/features/complaints/list-data";
import { ComplaintListTable } from "@/features/complaints/list-table";
import { ComplaintListToolbar } from "@/features/complaints/list-toolbar";
import { PageHeading } from "@/components/ui/page-heading";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

export default async function ComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  let canEdit = false;
  try {
    const user = await requireUser();
    canEdit = hasPermission(user.role, "complaint.edit");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const params = await searchParams;
  const { query, page } = parseComplaintListParams(params);

  const [{ rows, count }, filters] = await Promise.all([
    listComplaints(query),
    loadListFilterOptions(),
  ]);
  const labels = await loadListLabelMaps(rows);

  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / COMPLAINT_LIST_PER_PAGE));
  const emptyFiltered = Boolean(
    query.q ||
      query.customerPageId ||
      query.severityId ||
      query.statusId ||
      query.staffUserId ||
      query.occurredOnFrom ||
      query.occurredOnTo ||
      query.dueDateFrom ||
      query.dueDateTo ||
      query.unresolvedOnly,
  );

  return (
    <div className="space-y-3">
      <PageHeading
        title="クレーム一覧"
        description="クレームの内容・重要度・対応状況・社内対応責任者を管理します。"
        status={
          query.unresolvedOnly ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
              未解決のみ
            </span>
          ) : null
        }
        meta={`${total}件`}
        actions={
          canEdit ? (
            <Link
              href="/complaints/new"
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
            >
              クレームを登録
            </Link>
          ) : null
        }
      />

      <ComplaintListToolbar query={query} filters={filters} />

      <ComplaintListTable
        rows={rows}
        labels={labels}
        query={query}
        params={params}
        canEdit={canEdit}
        emptyFiltered={emptyFiltered}
      />

      <div className="flex items-center gap-3 text-xs text-slate-600">
        <span>
          {total === 0
            ? "0件"
            : `${(page - 1) * COMPLAINT_LIST_PER_PAGE + 1}-${Math.min(
                page * COMPLAINT_LIST_PER_PAGE,
                total,
              )} / ${total}件`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={`/complaints${buildComplaintListSearch(params, {
                page: String(page - 1),
              })}`}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            >
              前へ
            </Link>
          ) : (
            <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">
              前へ
            </span>
          )}
          <span>
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`/complaints${buildComplaintListSearch(params, {
                page: String(page + 1),
              })}`}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            >
              次へ
            </Link>
          ) : (
            <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">
              次へ
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
