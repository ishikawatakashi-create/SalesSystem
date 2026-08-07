import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/require";
import { listActivities } from "@/lib/activities/read-list";
import {
  ACTIVITY_LIST_PER_PAGE,
  buildActivityListSearch,
  parseActivityListParams,
} from "@/lib/activities/list-params";
import {
  loadListFilterOptions,
  loadListLabelMaps,
} from "@/features/activities/list-data";
import { ActivityListTable } from "@/features/activities/list-table";
import { ActivityListToolbar } from "@/features/activities/list-toolbar";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  let canEdit = false;
  let canBulk = false;
  try {
    const user = await requireUser();
    canEdit = hasPermission(user.role, "activity.edit");
    canBulk = hasPermission(user.role, "activity.bulk_create");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const params = await searchParams;
  const { query, page } = parseActivityListParams(params);

  const [{ rows, count }, filters] = await Promise.all([
    listActivities(query),
    loadListFilterOptions(),
  ]);
  const labels = await loadListLabelMaps(rows);

  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / ACTIVITY_LIST_PER_PAGE));
  const emptyFiltered = Boolean(
    query.q ||
      query.customerPageId ||
      query.contactPageId ||
      query.dealPageId ||
      query.categoryId ||
      query.createdBy ||
      query.activityAtFrom ||
      query.activityAtTo,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">対応履歴一覧</h1>
        <span className="text-xs text-slate-500">{total}件</span>
        <div className="ml-auto flex items-center gap-2">
          {canBulk && (
            <Link
              href="/activities/bulk"
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
            >
              一括登録
            </Link>
          )}
          {canEdit && (
            <Link
              href="/activities/new"
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
            >
              新規登録
            </Link>
          )}
        </div>
      </div>

      <ActivityListToolbar query={query} filters={filters} />

      <ActivityListTable
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
            : `${(page - 1) * ACTIVITY_LIST_PER_PAGE + 1}-${Math.min(
                page * ACTIVITY_LIST_PER_PAGE,
                total,
              )} / ${total}件`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={`/activities${buildActivityListSearch(params, {
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
              href={`/activities${buildActivityListSearch(params, {
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
