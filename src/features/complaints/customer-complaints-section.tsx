import Link from "next/link";

import { CompactEmptyState } from "@/components/ui/compact-empty-state";
import type { ComplaintIndexRow } from "@/lib/complaints/types";
import { formatDate } from "@/features/complaints/format";
import type { ListLabelMaps } from "@/features/complaints/list-data";

export function CustomerComplaintsSection({
  customerPageId,
  complaints,
  labels,
  canEdit,
  customerArchived,
}: {
  customerPageId: string;
  complaints: ComplaintIndexRow[];
  labels: ListLabelMaps;
  canEdit: boolean;
  customerArchived: boolean;
}) {
  return (
    <section className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-2.5 py-1.5">
        <h2 className="text-xs font-bold text-slate-700">未解決クレーム</h2>
        <span className="text-xs text-slate-500">{complaints.length}件</span>
        <Link
          href={`/complaints?customer=${customerPageId}&unresolved=0`}
          className="text-xs text-slate-600 underline-offset-2 hover:underline"
        >
          すべて見る
        </Link>
        {canEdit && !customerArchived && complaints.length > 0 && (
          <Link
            href={`/customers/${customerPageId}/complaints/new`}
            className="ml-auto text-xs text-slate-600 underline-offset-2 hover:underline"
          >
            追加
          </Link>
        )}
      </div>
      {complaints.length === 0 ? (
        <div className="px-2.5 py-1.5">
          <CompactEmptyState
            message="未解決のクレームはありません。"
            actionHref={
              canEdit && !customerArchived
                ? `/customers/${customerPageId}/complaints/new`
                : undefined
            }
            actionLabel={
              canEdit && !customerArchived ? "クレームを登録" : undefined
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
                <th className="px-2 py-1 font-medium">発生日</th>
                <th className="px-2 py-1 font-medium">タイトル</th>
                <th className="px-2 py-1 font-medium">重要度</th>
                <th className="px-2 py-1 font-medium">対応責任者</th>
                <th className="px-2 py-1 font-medium">期限</th>
                <th className="px-2 py-1 font-medium">対応状況</th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((row) => (
                <tr
                  key={row.notion_page_id}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-2 py-1">{formatDate(row.occurred_on)}</td>
                  <td className="max-w-48 truncate px-2 py-1 font-medium">
                    <Link
                      href={`/complaints/${row.notion_page_id}`}
                      className="text-primary hover:underline"
                    >
                      {row.title || "(無題)"}
                    </Link>
                  </td>
                  <td className="px-2 py-1">
                    {row.severity_id
                      ? (labels.severityNames.get(row.severity_id) ?? "—")
                      : "—"}
                  </td>
                  <td className="px-2 py-1">
                    {row.staff_page_id
                      ? (labels.staffNamesByPageId.get(row.staff_page_id) ?? "—")
                      : "—"}
                  </td>
                  <td className="px-2 py-1">{formatDate(row.due_date)}</td>
                  <td className="px-2 py-1">
                    {row.status_id
                      ? (labels.statusNames.get(row.status_id) ?? "—")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}