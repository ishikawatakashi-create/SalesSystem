import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/require";
import { listDeals } from "@/lib/deals/read-list";
import {
  DEAL_LIST_PER_PAGE,
  buildDealListSearch,
  parseDealListParams,
} from "@/lib/deals/list-params";
import {
  loadListFilterOptions,
  loadListLabelMaps,
} from "@/features/deals/list-data";
import { DealListTable } from "@/features/deals/list-table";
import { DealListToolbar } from "@/features/deals/list-toolbar";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  let canEdit = false;
  try {
    const user = await requireUser();
    canEdit = hasPermission(user.role, "deal.edit");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const params = await searchParams;
  const { query, page } = parseDealListParams(params);

  const [{ rows, count }, filters] = await Promise.all([
    listDeals(query),
    loadListFilterOptions(),
  ]);
  const labels = await loadListLabelMaps(rows);

  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / DEAL_LIST_PER_PAGE));
  const emptyFiltered = Boolean(
    query.q ||
      query.customerPageId ||
      query.stageId ||
      query.statusId ||
      query.staffUserId,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">案件一覧</h1>
        <span className="text-xs text-slate-500">{total}件</span>
        {canEdit && (
          <Link
            href="/deals/new"
            className="ml-auto rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
          >
            新規登録
          </Link>
        )}
      </div>

      <DealListToolbar query={query} filters={filters} />

      <DealListTable
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
            : `${(page - 1) * DEAL_LIST_PER_PAGE + 1}-${Math.min(
                page * DEAL_LIST_PER_PAGE,
                total,
              )} / ${total}件`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={`/deals${buildDealListSearch(params, {
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
              href={`/deals${buildDealListSearch(params, {
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
