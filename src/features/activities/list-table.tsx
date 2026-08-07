import Link from "next/link";

import { buildActivityListSearch } from "@/lib/activities/list-params";
import type {
  ActivityIndexRow,
  ActivityListQuery,
  ActivityListSortKey,
} from "@/lib/activities/types";
import { ClickableRow } from "@/features/deals/clickable-row";
import {
  formatDateTime,
  formatOptional,
} from "@/features/activities/format";
import type { ListLabelMaps } from "@/features/activities/list-data";

type RawParams = Record<string, string | string[] | undefined>;

const SORTABLE: Partial<Record<string, ActivityListSortKey>> = {
  タイトル: "title",
  対応日時: "activity_at",
  更新日時: "updated_at",
  作成日時: "created_at",
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

export function ActivityListTable({
  rows,
  labels,
  query,
  params,
  canEdit,
  emptyFiltered,
}: {
  rows: ActivityIndexRow[];
  labels: ListLabelMaps;
  query: ActivityListQuery;
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
        href={`/activities${buildActivityListSearch(params, {
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
            <th className="px-2 py-1.5 font-medium">
              {sortHeader("対応日時")}
            </th>
            <th className="px-2 py-1.5 font-medium">{sortHeader("タイトル")}</th>
            <th className="px-2 py-1.5 font-medium">顧客</th>
            <th className="px-2 py-1.5 font-medium">分類</th>
            <th className="px-2 py-1.5 font-medium">登録者</th>
            <th className="px-2 py-1.5 font-medium">案件</th>
            <th className="px-2 py-1.5 font-medium">要約</th>
            <th className="px-2 py-1.5 font-medium">
              {sortHeader("更新日時")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={8}
                className="px-3 py-10 text-center text-slate-500"
              >
                {emptyFiltered
                  ? "条件に一致する対応履歴がありません。条件を変更してください。"
                  : "対応履歴が登録されていません。"}
                {canEdit && !emptyFiltered && (
                  <span className="ml-2">
                    <Link
                      href="/activities/new"
                      className="text-primary underline"
                    >
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
              href={`/activities/${row.notion_page_id}`}
            >
              <td className="px-2 py-1.5">
                {formatDateTime(row.activity_at)}
              </td>
              <td className="max-w-48 truncate px-2 py-1.5 font-medium">
                <Link
                  href={`/activities/${row.notion_page_id}`}
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
              <td className="max-w-36 truncate px-2 py-1.5">
                {joinNames(row.category_ids ?? [], labels.categoryNames)}
              </td>
              <td className="px-2 py-1.5">
                {formatOptional(
                  row.created_by_name ??
                    (row.created_by
                      ? labels.createdByNames.get(row.created_by)
                      : null),
                )}
              </td>
              <td className="max-w-36 truncate px-2 py-1.5">
                {row.deal_page_id ? (
                  <Link
                    href={`/deals/${row.deal_page_id}`}
                    className="text-primary hover:underline"
                  >
                    {labels.dealTitles.get(row.deal_page_id) ?? "(不明)"}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className="max-w-48 truncate px-2 py-1.5 text-slate-600">
                {formatOptional(row.summary)}
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
