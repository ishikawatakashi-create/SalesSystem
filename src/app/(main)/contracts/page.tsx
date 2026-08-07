import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/require";
import { listContracts } from "@/lib/contracts/read-list";
import {
  CONTRACT_LIST_PER_PAGE,
  buildContractListSearch,
  parseContractListParams,
} from "@/lib/contracts/list-params";
import {
  loadListFilterOptions,
  loadListLabelMaps,
} from "@/features/contracts/list-data";
import { ContractListTable } from "@/features/contracts/list-table";
import { ContractListToolbar } from "@/features/contracts/list-toolbar";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  let canEdit = false;
  try {
    const user = await requireUser();
    canEdit = hasPermission(user.role, "contract.edit");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const params = await searchParams;
  const { query, page } = parseContractListParams(params);

  const [{ rows, count }, filters] = await Promise.all([
    listContracts(query),
    loadListFilterOptions(),
  ]);
  const labels = await loadListLabelMaps(rows);

  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / CONTRACT_LIST_PER_PAGE));
  const emptyFiltered = Boolean(
    query.q ||
      query.customerPageId ||
      query.tradeTypeId ||
      query.statusId ||
      query.paymentStatusId ||
      query.staffUserId ||
      query.amountMin !== undefined ||
      query.amountMax !== undefined ||
      query.contractedAtFrom ||
      query.contractedAtTo ||
      query.endDateFrom ||
      query.endDateTo,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">契約一覧</h1>
        <span className="text-xs text-slate-500">{total}件</span>
        {canEdit && (
          <Link
            href="/contracts/new"
            className="ml-auto rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
          >
            新規登録
          </Link>
        )}
      </div>

      <ContractListToolbar query={query} filters={filters} />

      <ContractListTable
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
            : `${(page - 1) * CONTRACT_LIST_PER_PAGE + 1}-${Math.min(
                page * CONTRACT_LIST_PER_PAGE,
                total,
              )} / ${total}件`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={`/contracts${buildContractListSearch(params, {
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
              href={`/contracts${buildContractListSearch(params, {
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
