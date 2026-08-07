import Link from "next/link";

import { buildComplaintListSearch } from "@/lib/complaints/list-params";
import {
  isComplaintUnresolved,
  type ComplaintIndexRow,
  type ComplaintListQuery,
  type ComplaintListSortKey,
} from "@/lib/complaints/types";
import { ClickableRow } from "@/features/complaints/clickable-row";
import {
  formatDate,
  formatDateTime,
  formatOptional,
} from "@/features/complaints/format";
import type { ListLabelMaps } from "@/features/complaints/list-data";

type RawParams = Record<string, string | string[] | undefined>;

const SORTABLE: Partial<Record<string, ComplaintListSortKey>> = {
  タイトル: "title",
  発生日: "occurred_on",
  期限: "due_date",
  更新日時: "updated_at",
};

export function ComplaintListTable({
  rows,
  labels,
  query,
  params,
  canEdit,
  emptyFiltered,
}: {
  rows: ComplaintIndexRow[];
  labels: ListLabelMaps;
  query: ComplaintListQuery;
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
        href={`/complaints${buildComplaintListSearch(params, {
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
            <th className="px-2 py-1.5 font-medium">{sortHeader("発生日")}</th>
            <th className="px-2 py-1.5 font-medium">{sortHeader("タイトル")}</th>
            <th className="px-2 py-1.5 font-medium">顧客</th>
            <th className="px-2 py-1.5 font-medium">重要度</th>
            <th className="px-2 py-1.5 font-medium">対応状況</th>
            <th className="px-2 py-1.5 font-medium">対応責任者</th>
            <th className="px-2 py-1.5 font-medium">{sortHeader("期限")}</th>
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
                  ? "条件に一致するクレームがありません。条件を変更してください。"
                  : "クレームが登録されていません。"}
                {canEdit && !emptyFiltered && (
                  <span className="ml-2">
                    <Link
                      href="/complaints/new"
                      className="text-primary underline"
                    >
                      新規登録
                    </Link>
                  </span>
                )}
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const unresolved = isComplaintUnresolved(row.status_semantic);
            return (
              <ClickableRow
                key={row.notion_page_id}
                href={`/complaints/${row.notion_page_id}`}
                className={unresolved ? "bg-amber-50/40" : undefined}
              >
                <td className="px-2 py-1.5">{formatDate(row.occurred_on)}</td>
                <td className="max-w-48 truncate px-2 py-1.5 font-medium">
                  <Link
                    href={`/complaints/${row.notion_page_id}`}
                    className="text-primary hover:underline"
                  >
                    {row.title || "(無題)"}
                  </Link>
                  {row.summary && (
                    <span className="ml-1 text-[10px] text-slate-400">
                      {formatOptional(row.summary)}
                    </span>
                  )}
                </td>
                <td className="max-w-40 truncate px-2 py-1.5">
                  {row.customer_page_id ? (
                    <Link
                      href={`/customers/${row.customer_page_id}`}
                      className="text-primary hover:underline"
                    >
                      {labels.customerNames.get(row.customer_page_id) ??
                        "(不明)"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {row.severity_id
                    ? (labels.severityNames.get(row.severity_id) ?? "—")
                    : "—"}
                </td>
                <td className="px-2 py-1.5">
                  {row.status_id
                    ? (labels.statusNames.get(row.status_id) ?? "—")
                    : "—"}
                </td>
                <td className="px-2 py-1.5">
                  {row.staff_page_id
                    ? (labels.staffNamesByPageId.get(row.staff_page_id) ?? "—")
                    : "—"}
                </td>
                <td className="px-2 py-1.5">{formatDate(row.due_date)}</td>
                <td className="px-2 py-1.5">
                  {formatDateTime(row.updated_at)}
                </td>
              </ClickableRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
