import Link from "next/link";

import { buildActionListSearch } from "@/lib/actions/list-params";
import type {
  ActionIndexRow,
  ActionListQuery,
  ActionListSortKey,
} from "@/lib/actions/types";
import { ClickableRow } from "@/features/deals/clickable-row";
import { CompleteActionButton } from "@/features/actions/complete-button";
import {
  formatDate,
  formatDateTime,
  overdueDaysTokyo,
} from "@/features/actions/format";
import type { ListLabelMaps } from "@/features/actions/list-data";

type RawParams = Record<string, string | string[] | undefined>;

const SORTABLE: Partial<Record<string, ActionListSortKey>> = {
  内容: "title",
  期限: "due_date",
  完了日時: "completed_at",
  更新日時: "updated_at",
};

export function ActionListTable({
  rows,
  labels,
  query,
  params,
  canEdit,
  emptyFiltered,
}: {
  rows: ActionIndexRow[];
  labels: ListLabelMaps;
  query: ActionListQuery;
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
        href={`/actions${buildActionListSearch(params, {
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
            <th className="px-2 py-1.5 font-medium">{sortHeader("期限")}</th>
            <th className="px-2 py-1.5 font-medium">{sortHeader("内容")}</th>
            <th className="px-2 py-1.5 font-medium">顧客</th>
            <th className="px-2 py-1.5 font-medium">担当</th>
            <th className="px-2 py-1.5 font-medium">状態</th>
            <th className="px-2 py-1.5 font-medium">優先度</th>
            <th className="px-2 py-1.5 font-medium">案件</th>
            <th className="px-2 py-1.5 font-medium">
              {sortHeader("更新日時")}
            </th>
            {canEdit && (
              <th className="px-2 py-1.5 font-medium">操作</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={canEdit ? 9 : 8}
                className="px-3 py-10 text-center text-slate-500"
              >
                {emptyFiltered
                  ? "条件に一致するアクションがありません。条件を変更してください。"
                  : "アクションが登録されていません。"}
                {canEdit && !emptyFiltered && (
                  <span className="ml-2">
                    <Link
                      href="/actions/new"
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
            const overdue = row.is_open
              ? overdueDaysTokyo(row.due_date)
              : null;
            return (
              <ClickableRow
                key={row.notion_page_id}
                href={`/actions/${row.notion_page_id}`}
              >
                <td
                  className={`px-2 py-1.5 ${
                    overdue ? "font-medium text-red-700" : ""
                  }`}
                >
                  {formatDate(row.due_date)}
                  {overdue != null && (
                    <span className="ml-1 text-[10px]">
                      ({overdue}日超過)
                    </span>
                  )}
                </td>
                <td className="max-w-48 truncate px-2 py-1.5 font-medium">
                  <Link
                    href={`/actions/${row.notion_page_id}`}
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
                      {labels.customerNames.get(row.customer_page_id) ??
                        "(不明)"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {row.staff_page_id
                    ? (labels.staffNamesByPageId.get(row.staff_page_id) ??
                      (row.assignee_user_id
                        ? labels.assigneeNames.get(row.assignee_user_id)
                        : null) ??
                      "—")
                    : row.assignee_user_id
                      ? (labels.assigneeNames.get(row.assignee_user_id) ??
                        "—")
                      : "—"}
                </td>
                <td className="px-2 py-1.5">
                  {row.status_id
                    ? (labels.statusNames.get(row.status_id) ?? "—")
                    : row.is_open
                      ? "未完了"
                      : "—"}
                </td>
                <td className="px-2 py-1.5">
                  {row.priority_id
                    ? (labels.priorityNames.get(row.priority_id) ?? "—")
                    : "—"}
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
                <td className="px-2 py-1.5">
                  {formatDateTime(row.updated_at)}
                </td>
                {canEdit && (
                  <td className="px-2 py-1.5">
                    {row.is_open && row.notion_last_edited_at ? (
                      <CompleteActionButton
                        notionPageId={row.notion_page_id}
                        externalId={row.external_id}
                        lastEditedTime={row.notion_last_edited_at}
                        compact
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                )}
              </ClickableRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
