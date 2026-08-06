import Link from "next/link";

import { buildDealListSearch } from "@/lib/deals/list-params";
import type { DealIndexRow, DealListQuery, DealListSortKey } from "@/lib/deals/types";
import { ClickableRow } from "@/features/deals/clickable-row";
import {
  formatDate,
  formatDateTime,
  formatYen,
} from "@/features/deals/format";
import type { ListLabelMaps } from "@/features/deals/list-data";

type RawParams = Record<string, string | string[] | undefined>;

const SORTABLE: Partial<Record<string, DealListSortKey>> = {
  案件名: "title",
  見込み金額: "expected_amount",
  見込みクローズ日: "expected_close_date",
  更新日時: "updated_at",
};

function joinNames(
  ids: string[],
  map: Map<string, string>,
  limit = 3,
): string {
  if (ids.length === 0) return "—";
  const names = ids.map((id) => map.get(id) ?? "(不明)");
  if (names.length <= limit) return names.join("、");
  return `${names.slice(0, limit).join("、")} 他${names.length - limit}`;
}

export function DealListTable({
  rows,
  labels,
  query,
  params,
  canEdit,
  emptyFiltered,
}: {
  rows: DealIndexRow[];
  labels: ListLabelMaps;
  query: DealListQuery;
  params: RawParams;
  canEdit: boolean;
  emptyFiltered: boolean;
}) {
  const sortHeader = (label: string) => {
    const key = SORTABLE[label];
    if (!key) return <span>{label}</span>;
    const nextDir =
      query.sort === key && query.sortDir !== "asc" ? "asc" : "desc";
    return (
      <Link
        href={`/deals${buildDealListSearch(params, {
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
      </Link>
    );
  };

  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="w-full whitespace-nowrap text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
            <th className="px-2 py-1.5 font-medium">{sortHeader("案件名")}</th>
            <th className="px-2 py-1.5 font-medium">顧客</th>
            <th className="px-2 py-1.5 font-medium">ステージ</th>
            <th className="px-2 py-1.5 font-medium">ステータス</th>
            <th className="px-2 py-1.5 font-medium">
              {sortHeader("見込み金額")}
            </th>
            <th className="px-2 py-1.5 font-medium">顧客担当者</th>
            <th className="px-2 py-1.5 font-medium">自社担当者</th>
            <th className="px-2 py-1.5 font-medium">
              {sortHeader("見込みクローズ日")}
            </th>
            <th className="px-2 py-1.5 font-medium">
              {sortHeader("更新日時")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={9}
                className="px-3 py-10 text-center text-slate-500"
              >
                {emptyFiltered
                  ? "条件に一致する案件がありません。条件を変更してください。"
                  : "案件が登録されていません。"}
                {canEdit && !emptyFiltered && (
                  <span className="ml-2">
                    <Link href="/deals/new" className="text-primary underline">
                      新規登録
                    </Link>
                  </span>
                )}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <ClickableRow
              key={row.notion_page_id}
              href={`/deals/${row.notion_page_id}`}
            >
              <td className="max-w-48 truncate px-2 py-1.5 font-medium">
                <Link
                  href={`/deals/${row.notion_page_id}`}
                  className="text-primary hover:underline"
                >
                  {row.title || "(無題)"}
                </Link>
              </td>
              <td className="max-w-40 truncate px-2 py-1.5">
                {row.customer_page_id ? (
                  <Link
                    href={`/customers/${row.customer_page_id}`}
                    className="text-primary hover:underline"
                  >
                    {labels.customerNames.get(row.customer_page_id) ?? "(不明)"}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-2 py-1.5">
                {row.stage_id
                  ? (labels.stageNames.get(row.stage_id) ?? "—")
                  : "—"}
              </td>
              <td className="px-2 py-1.5">
                {row.status_id
                  ? (labels.statusNames.get(row.status_id) ?? "—")
                  : "—"}
              </td>
              <td className="px-2 py-1.5">
                {formatYen(row.expected_amount)}
              </td>
              <td className="max-w-40 truncate px-2 py-1.5">
                {joinNames(row.contact_page_ids ?? [], labels.contactNames)}
              </td>
              <td className="max-w-40 truncate px-2 py-1.5">
                {joinNames(
                  row.staff_page_ids ?? [],
                  labels.staffNamesByPageId,
                )}
              </td>
              <td className="px-2 py-1.5">
                {formatDate(row.expected_close_date)}
              </td>
              <td className="px-2 py-1.5">
                {formatDateTime(row.updated_at)}
              </td>
            </ClickableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
