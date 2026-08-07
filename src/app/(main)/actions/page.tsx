import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/require";
import { listActions } from "@/lib/actions/read-list";
import {
  ACTION_LIST_PER_PAGE,
  buildActionListSearch,
  parseActionListParams,
} from "@/lib/actions/list-params";
import {
  loadListFilterOptions,
  loadListLabelMaps,
} from "@/features/actions/list-data";
import { ActionListTable } from "@/features/actions/list-table";
import {
  ActionListTabs,
  ActionListToolbar,
} from "@/features/actions/list-toolbar";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  let canEdit = false;
  try {
    const user = await requireUser();
    canEdit = hasPermission(user.role, "action.edit");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const params = await searchParams;
  const { query, page, view } = parseActionListParams(params);

  const [{ rows, count }, filters] = await Promise.all([
    listActions(query),
    loadListFilterOptions(),
  ]);
  const labels = await loadListLabelMaps(rows);

  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / ACTION_LIST_PER_PAGE));
  const emptyFiltered = Boolean(
    query.q ||
      query.customerPageId ||
      query.dealPageId ||
      query.assigneeUserId ||
      query.staffPageId ||
      query.statusId ||
      query.dueDateFrom ||
      query.dueDateTo ||
      view !== "today-overdue",
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">次回アクション一覧</h1>
        <span className="text-xs text-slate-500">{total}件</span>
        {canEdit && (
          <Link
            href="/actions/new"
            className="ml-auto rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
          >
            新規登録
          </Link>
        )}
      </div>

      <ActionListTabs view={view} params={params} />
      <ActionListToolbar query={query} filters={filters} view={view} />

      <ActionListTable
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
            : `${(page - 1) * ACTION_LIST_PER_PAGE + 1}-${Math.min(
                page * ACTION_LIST_PER_PAGE,
                total,
              )} / ${total}件`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={`/actions${buildActionListSearch(params, {
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
              href={`/actions${buildActionListSearch(params, {
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
