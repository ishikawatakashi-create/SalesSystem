import Link from "next/link";

import type { ActivityIndexRow } from "@/lib/activities/types";
import type { ActionIndexRow } from "@/lib/actions/types";
import {
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

export function ContactRelatedSection({
  contactPageId,
  customerPageId,
  activities,
  activityLabels,
  openActions,
  actionLabels,
  canEditActivity,
  canEditAction,
}: {
  contactPageId: string;
  customerPageId: string | null;
  activities: ActivityIndexRow[];
  activityLabels: ActivityLabels;
  openActions: ActionIndexRow[];
  actionLabels: ActionLabels;
  canEditActivity: boolean;
  canEditAction: boolean;
}) {
  return (
    <div className="space-y-3">
      <section className="rounded border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <h2 className="text-xs font-bold text-slate-700">
            この担当者の対応履歴
          </h2>
          <span className="text-xs text-slate-500">{activities.length}件</span>
          {canEditActivity && customerPageId && (
            <Link
              href={`/contacts/${contactPageId}/activities/new`}
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
                    この担当者に紐づく対応履歴はありません。
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
      </section>

      <section className="rounded border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <h2 className="text-xs font-bold text-slate-700">
            所属顧客の未完了アクション
          </h2>
          <span className="text-xs text-slate-500">{openActions.length}件</span>
          {canEditAction && customerPageId && (
            <Link
              href={`/contacts/${contactPageId}/actions/new`}
              className="ml-auto rounded bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover"
            >
              アクションを追加
            </Link>
          )}
        </div>
        <p className="border-b border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">
          アクションに先方担当者フィールドはないため、同じ顧客の未完了アクションを表示しています。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
                <th className="px-2 py-1.5 font-medium">期限</th>
                <th className="px-2 py-1.5 font-medium">内容</th>
                <th className="px-2 py-1.5 font-medium">担当</th>
                {canEditAction && (
                  <th className="px-2 py-1.5 font-medium">操作</th>
                )}
              </tr>
            </thead>
            <tbody>
              {openActions.length === 0 && (
                <tr>
                  <td
                    colSpan={canEditAction ? 4 : 3}
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
