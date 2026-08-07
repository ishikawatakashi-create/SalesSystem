import Link from "next/link";

import type { ActivityIndexRow } from "@/lib/activities/types";
import type { ActionIndexRow } from "@/lib/actions/types";
import {
  formatDate,
  formatDateTime,
  formatOptional,
} from "@/features/activities/format";
import type { ListLabelMaps as ActivityLabels } from "@/features/activities/list-data";
import {
  formatDate as formatActionDate,
  overdueDaysTokyo,
} from "@/features/actions/format";
import type { ListLabelMaps as ActionLabels } from "@/features/actions/list-data";
import { CompleteActionButton } from "@/features/actions/complete-button";

function joinNames(
  ids: string[],
  map: Map<string, string>,
  limit = 2,
): string {
  if (ids.length === 0) return "—";
  const names = ids.map((id) => map.get(id) ?? "(不明)");
  if (names.length <= limit) return names.join("、");
  return `${names.slice(0, limit).join("、")} 他${names.length - limit}`;
}

export function CustomerActivitiesSection({
  customerPageId,
  activities,
  activityLabels,
  openActions,
  actionLabels,
  canEditActivity,
  canEditAction,
  customerArchived,
  derived,
}: {
  customerPageId: string;
  activities: ActivityIndexRow[];
  activityLabels: ActivityLabels;
  openActions: ActionIndexRow[];
  actionLabels: ActionLabels;
  canEditActivity: boolean;
  canEditAction: boolean;
  customerArchived: boolean;
  derived: {
    latestActivitySummary: string | null;
    lastActivityAt: string | null;
    nextAction: string | null;
    nextActionDate: string | null;
  };
}) {
  const nextOverdue = overdueDaysTokyo(derived.nextActionDate);

  return (
    <div className="space-y-3">
      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-1 text-xs font-bold text-slate-700">
          対応・次回(導出)
        </h2>
        <dl className="grid grid-cols-1 gap-x-4 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0">
          <div className="flex gap-2 py-1">
            <dt className="w-28 shrink-0 text-xs text-slate-500">最新対応内容</dt>
            <dd className="text-xs">
              {formatOptional(derived.latestActivitySummary)}
            </dd>
          </div>
          <div className="flex gap-2 py-1">
            <dt className="w-28 shrink-0 text-xs text-slate-500">最終対応日</dt>
            <dd className="text-xs">{formatDate(derived.lastActivityAt)}</dd>
          </div>
          <div className="flex gap-2 py-1">
            <dt className="w-28 shrink-0 text-xs text-slate-500">
              次回アクション
            </dt>
            <dd className="text-xs">
              {formatOptional(derived.nextAction)}
              <span className="ml-2 text-[10px] text-slate-400">
                未完了の最短期限から自動導出
              </span>
            </dd>
          </div>
          <div className="flex gap-2 py-1">
            <dt className="w-28 shrink-0 text-xs text-slate-500">次回予定日</dt>
            <dd
              className={`text-xs ${nextOverdue ? "font-medium text-red-700" : ""}`}
            >
              {formatDate(derived.nextActionDate)}
              {nextOverdue != null && (
                <span className="ml-1 text-[10px]">({nextOverdue}日超過)</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <h2 className="text-xs font-bold text-slate-700">対応履歴</h2>
          <span className="text-xs text-slate-500">{activities.length}件</span>
          {canEditActivity && !customerArchived && (
            <Link
              href={`/customers/${customerPageId}/activities/new`}
              className="ml-auto rounded bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover"
            >
              履歴を追加
            </Link>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
                <th className="px-2 py-1.5 font-medium">対応日時</th>
                <th className="px-2 py-1.5 font-medium">タイトル</th>
                <th className="px-2 py-1.5 font-medium">分類</th>
                <th className="px-2 py-1.5 font-medium">登録者</th>
              </tr>
            </thead>
            <tbody>
              {activities.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    対応履歴は登録されていません。
                    {canEditActivity && !customerArchived && (
                      <span className="ml-2">
                        <Link
                          href={`/customers/${customerPageId}/activities/new`}
                          className="text-primary underline"
                        >
                          履歴を追加
                        </Link>
                      </span>
                    )}
                  </td>
                </tr>
              )}
              {activities.slice(0, 20).map((row) => (
                <tr
                  key={row.notion_page_id}
                  className="border-b border-slate-100 hover:bg-slate-50"
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
                  <td className="max-w-36 truncate px-2 py-1.5">
                    {joinNames(
                      row.category_ids ?? [],
                      activityLabels.categoryNames,
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {formatOptional(row.created_by_name)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {activities.length > 20 && (
          <div className="border-t border-slate-100 px-3 py-2 text-xs">
            <Link
              href={`/activities?customer=${customerPageId}`}
              className="text-primary underline"
            >
              すべての対応履歴を見る
            </Link>
          </div>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <h2 className="text-xs font-bold text-slate-700">
            次回アクション(未完了)
          </h2>
          <span className="text-xs text-slate-500">{openActions.length}件</span>
          {canEditAction && !customerArchived && (
            <Link
              href={`/customers/${customerPageId}/actions/new`}
              className="ml-auto rounded bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover"
            >
              アクションを追加
            </Link>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
                <th className="px-2 py-1.5 font-medium">期限</th>
                <th className="px-2 py-1.5 font-medium">内容</th>
                <th className="px-2 py-1.5 font-medium">担当</th>
                <th className="px-2 py-1.5 font-medium">優先度</th>
                {canEditAction && (
                  <th className="px-2 py-1.5 font-medium">操作</th>
                )}
              </tr>
            </thead>
            <tbody>
              {openActions.length === 0 && (
                <tr>
                  <td
                    colSpan={canEditAction ? 5 : 4}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    未完了のアクションはありません。
                  </td>
                </tr>
              )}
              {openActions.map((row) => {
                const overdue = overdueDaysTokyo(row.due_date);
                return (
                  <tr
                    key={row.notion_page_id}
                    className="border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td
                      className={`px-2 py-1.5 ${
                        overdue ? "font-medium text-red-700" : ""
                      }`}
                    >
                      {formatActionDate(row.due_date)}
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
                    <td className="px-2 py-1.5">
                      {row.staff_page_id
                        ? (actionLabels.staffNamesByPageId.get(
                            row.staff_page_id,
                          ) ?? "—")
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.priority_id
                        ? (actionLabels.priorityNames.get(row.priority_id) ??
                          "—")
                        : "—"}
                    </td>
                    {canEditAction && (
                      <td className="px-2 py-1.5">
                        {row.notion_last_edited_at ? (
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
