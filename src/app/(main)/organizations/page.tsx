import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/require";
import { listCustomers } from "@/lib/customers/read-list";
import {
  CUSTOMER_LIST_PER_PAGE,
  buildListSearch,
  parseCustomerListParams,
} from "@/lib/customers/list-params";
import type { CustomerListSortKey } from "@/lib/customers/types";
import {
  loadListFilterOptions,
  loadListLabelMaps,
} from "@/features/customers/list-data";
import { ClickableRow } from "@/features/customers/clickable-row";
import { formatDate, formatYen } from "@/features/customers/format";
import { CustomerListToolbar } from "@/features/customers/list-toolbar";
import { RelationshipBadges } from "@/features/organizations/relationship-badges";
import { PRIMARY_ORGANIZATION_RELATIONSHIP_FILTERS } from "@/lib/organizations/relationship";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

const SORTABLE: Partial<Record<string, CustomerListSortKey>> = {
  表示名: "display_name",
  最終対応日: "last_activity_at",
  次回予定日: "next_action_date",
  見込み金額: "expected_amount",
};

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  let canEdit = false;
  try {
    const user = await requireUser();
    canEdit = hasPermission(user.role, "customer.edit");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const params = await searchParams;
  const { query, page } = parseCustomerListParams(params);

  const [{ rows, count }, filters] = await Promise.all([
    listCustomers(query),
    loadListFilterOptions(),
  ]);
  const labels = await loadListLabelMaps(rows);

  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / CUSTOMER_LIST_PER_PAGE));
  const showingArchived = query.isArchived === true;

  const sortHeader = (label: string) => {
    const key = SORTABLE[label];
    if (!key) {
      return <span>{label}</span>;
    }
    const active = query.sort === key || (!query.sort && key === "updated_at");
    const nextDir =
      query.sort === key && query.sortDir !== "asc" ? "asc" : "desc";
    return (
      <Link
        href={`/organizations${buildListSearch(params, {
          sort: key,
          dir: nextDir,
          page: undefined,
        })}`}
        className="inline-flex items-center gap-0.5 hover:text-slate-900"
      >
        {label}
        {query.sort === key && (
          <span aria-hidden>{query.sortDir === "asc" ? "▲" : "▼"}</span>
        )}
        {!active ? null : null}
      </Link>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">組織一覧</h1>
        <span className="text-xs text-slate-500">
          {total}件{showingArchived ? "(アーカイブ済み)" : ""}
        </span>
        {canEdit && (
          <Link
            href="/organizations/new"
            className="ml-auto rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
          >
            組織を追加
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-1 text-xs">
        <Link
          href={`/organizations${buildListSearch(params, {
            relationship: undefined,
            page: undefined,
          })}`}
          className={
            !query.relationshipSemanticKey
              ? "rounded bg-slate-800 px-2 py-1 text-white"
              : "rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
          }
        >
          すべて
        </Link>
        {PRIMARY_ORGANIZATION_RELATIONSHIP_FILTERS.map((f) => (
          <Link
            key={f.semanticKey}
            href={`/organizations${buildListSearch(params, {
              relationship: f.semanticKey,
              page: undefined,
            })}`}
            className={
              query.relationshipSemanticKey === f.semanticKey
                ? "rounded bg-slate-800 px-2 py-1 text-white"
                : "rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
            }
          >
            {f.label}
          </Link>
        ))}
      </div>

      <CustomerListToolbar
        query={query}
        filters={filters}
        showingArchived={showingArchived}
      />

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full whitespace-nowrap text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
              <th className="px-2 py-1.5 font-medium">{sortHeader("表示名")}</th>
              <th className="px-2 py-1.5 font-medium">関係性</th>
              <th className="px-2 py-1.5 font-medium">法人名</th>
              <th className="px-2 py-1.5 font-medium">事業所名</th>
              <th className="px-2 py-1.5 font-medium">都道府県</th>
              <th className="px-2 py-1.5 font-medium">電話番号</th>
              <th className="px-2 py-1.5 font-medium">メール</th>
              <th className="px-2 py-1.5 font-medium">営業ステータス</th>
              <th className="px-2 py-1.5 font-medium">事業区分</th>
              <th className="px-2 py-1.5 font-medium">自社担当者</th>
              <th className="px-2 py-1.5 font-medium">{sortHeader("最終対応日")}</th>
              <th className="px-2 py-1.5 font-medium">{sortHeader("次回予定日")}</th>
              <th className="px-2 py-1.5 text-right font-medium">
                {sortHeader("見込み金額")}
              </th>
              <th className="px-2 py-1.5 font-medium">状態</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-10 text-center text-slate-500">
                  {query.q ||
                  query.salesStatusId ||
                  query.businessCategoryId ||
                  query.relationshipSemanticKey
                    ? "条件に一致する組織がありません。条件を変更してください。"
                    : "組織が登録されていません。"}
                  {canEdit && !showingArchived && (
                    <span className="ml-2">
                      <Link href="/organizations/new" className="text-primary underline">
                        組織を追加
                      </Link>
                    </span>
                  )}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <ClickableRow key={row.notion_page_id} href={`/organizations/${row.notion_page_id}`}>
                <td className="max-w-56 truncate px-2 py-1.5 font-medium">
                  <Link
                    href={`/organizations/${row.notion_page_id}`}
                    className="text-primary hover:underline"
                  >
                    {row.display_name}
                  </Link>
                </td>
                <td className="px-2 py-1.5">
                  <RelationshipBadges keys={row.relationship_semantic_keys} />
                </td>
                <td className="max-w-40 truncate px-2 py-1.5">{row.legal_name ?? "-"}</td>
                <td className="max-w-40 truncate px-2 py-1.5">{row.office_name ?? "-"}</td>
                <td className="px-2 py-1.5">{row.prefecture ?? "-"}</td>
                <td className="px-2 py-1.5">{row.phone ?? "-"}</td>
                <td className="max-w-48 truncate px-2 py-1.5">{row.email ?? "-"}</td>
                <td className="px-2 py-1.5">
                  {row.sales_status_id
                    ? (labels.masterNames.get(row.sales_status_id) ?? "-")
                    : "-"}
                </td>
                <td className="max-w-40 truncate px-2 py-1.5">
                  {row.business_category_ids.length > 0
                    ? row.business_category_ids
                        .map((id) => labels.masterNames.get(id) ?? "?")
                        .join("、")
                    : "-"}
                </td>
                <td className="max-w-32 truncate px-2 py-1.5">
                  {row.staff_user_ids.length > 0
                    ? row.staff_user_ids
                        .map((id) => labels.staffNames.get(id) ?? "?")
                        .join("、")
                    : "-"}
                </td>
                <td className="px-2 py-1.5">{formatDate(row.last_activity_at)}</td>
                <td className="px-2 py-1.5">{formatDate(row.next_action_date)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatYen(row.expected_amount)}
                </td>
                <td className="px-2 py-1.5">
                  {row.is_archived ? (
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">
                      アーカイブ
                    </span>
                  ) : (
                    <span className="text-slate-400">有効</span>
                  )}
                </td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-xs text-slate-600">
        <span>
          {total === 0
            ? "0件"
            : `${(page - 1) * CUSTOMER_LIST_PER_PAGE + 1}-${Math.min(
                page * CUSTOMER_LIST_PER_PAGE,
                total,
              )} / ${total}件`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={`/organizations${buildListSearch(params, { page: String(page - 1) })}`}
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
              href={`/organizations${buildListSearch(params, { page: String(page + 1) })}`}
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
