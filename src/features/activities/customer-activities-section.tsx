import Link from "next/link";

import { CompactEmptyState } from "@/components/ui/compact-empty-state";
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
    <div className="space-y-2">
      <section className="rounded border border-slate-200 bg-white p-2.5">
        <h2 className="mb-1 text-xs font-bold text-slate-700">
          最近の対応・次回予定
        </h2>
        <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <div className="flex gap-2 py-0.5">
            <dt className="w-24 shrink-0 text-xs text-slate-500">最新対応</dt>
            <dd className="text-xs">
              {formatOptional(derived.latestActivitySummary)}
            </dd>
          </div>
          <div className="flex gap-2 py-0.5">
            <dt className="w-24 shrink-0 text-xs text-slate-500">最終対応日</dt>
            <dd className="text-xs">{formatDate(derived.lastActivityAt)}</dd>
          </div>
          <div className="flex gap-2 py-0.5">
            <dt className="w-24 shrink-0 text-xs text-slate-500">
              次回アクション
            </dt>
            <dd className="text-xs">{formatOptional(derived.nextAction)}</dd>
          </div>
          <div className="flex gap-2 py-0.5">
            <dt className="w-24 shrink-0 text-xs text-slate-500">次回予定日</dt>
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
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-2.5 py-1.5">
          <h2 className="text-xs font-bold text-slate-700">対応履歴</h2>
          <span className="text-xs text-slate-500">{activities.length}件</span>
          {canEditActivity && !customerArchived && activities.length > 0 && (
            <Link
              href={`/customers/${customerPageId}/activities/new`}
              className="ml-auto text-xs text-slate-600 underline-offset-2 hover:underline"
            >
              詳細登録
            </Link>
          )}
        </div>
        {activities.length === 0 ? (
          <div className="px-2.5 py-1.5">
            <CompactEmptyState
              message="対応履歴はまだありません。"
              actionHref={
                canEditActivity && !customerArchived
                  ? `/customers/${customerPageId}/activities/new`
                  : undefined
              }
              actionLabel={
                canEditActivity && !customerArchived ? "詳細登録" : undefined
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
                  <th className="px-2 py-1 font-medium">対応日時</th>
                  <th className="px-2 py-1 font-medium">タイトル</th>
                  <th className="px-2 py-1 font-medium">分類</th>
                  <th className="px-2 py-1 font-medium">登録者</th>
                </tr>
              </thead>
              <tbody>
                {activities.slice(0, 20).map((row) => (
                  <tr
                    key={row.notion_page_id}
                    className="border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-2 py-1">
                      {formatDateTime(row.activity_at)}
                    </td>
                    <td className="max-w-48 truncate px-2 py-1 font-medium">
                      <Link
                        href={`/activities/${row.notion_page_id}`}
                        className="text-primary hover:underline"
                      >
                        {row.title || "(無題)"}
                      </Link>
                    </td>
                    <td className="max-w-36 truncate px-2 py-1">
                      {joinNames(
                        row.category_ids ?? [],
                        activityLabels.categoryNames,
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {formatOptional(row.created_by_name)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {activities.length > 20 && (
          <div className="border-t border-slate-100 px-2.5 py-1.5 text-xs">
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
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-2.5 py-1.5">
          <h2 className="text-xs font-bold text-slate-700">
            次回アクション(未完了)
          </h2>
          <span className="text-xs text-slate-500">{openActions.length}件</span>
          {canEditAction && !customerArchived && openActions.length > 0 && (
            <Link
              href={`/customers/${customerPageId}/actions/new`}
              className="ml-auto text-xs text-slate-600 underline-offset-2 hover:underline"
            >
              追加
            </Link>
          )}
        </div>
        {openActions.length === 0 ? (
          <div className="px-2.5 py-1.5">
            <CompactEmptyState
              message="未完了のアクションはありません。"
              actionHref={
                canEditAction && !customerArchived
                  ? `/customers/${customerPageId}/actions/new`
                  : undefined
              }
              actionLabel={
                canEditAction && !customerArchived ? "アクションを追加" : undefined
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
                  <th className="px-2 py-1 font-medium">期限</th>
                  <th className="px-2 py-1 font-medium">内容</th>
                  <th className="px-2 py-1 font-medium">担当</th>
                  <th className="px-2 py-1 font-medium">優先度</th>
                  {canEditAction && (
                    <th className="px-2 py-1 font-medium">操作</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {openActions.map((row) => {
                  const overdue = overdueDaysTokyo(row.due_date);
                  return (
                    <tr
                      key={row.notion_page_id}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td
                        className={`px-2 py-1 ${
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
                      <td className="max-w-48 truncate px-2 py-1 font-medium">
                        <Link
                          href={`/actions/${row.notion_page_id}`}
                          className="text-primary hover:underline"
                        >
                          {row.title || "(無題)"}
                        </Link>
                      </td>
                      <td className="px-2 py-1">
                        {row.staff_page_id
                          ? (actionLabels.staffNamesByPageId.get(
                              row.staff_page_id,
                            ) ?? "—")
                          : "—"}
                      </td>
                      <td className="px-2 py-1">
                        {row.priority_id
                          ? (actionLabels.priorityNames.get(row.priority_id) ??
                            "—")
                          : "—"}
                      </td>
                      {canEditAction && (
                        <td className="px-2 py-1">
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
        )}
      </section>
    </div>
  );
}
