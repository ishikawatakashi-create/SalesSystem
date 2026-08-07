import Link from "next/link";

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
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <h2 className="text-xs font-bold text-slate-700">未解決クレーム</h2>
        <span className="text-xs text-slate-500">{complaints.length}件</span>
        <Link
          href={`/complaints?customer=${customerPageId}&unresolved=0`}
          className="text-xs text-primary underline"
        >
          すべて見る
        </Link>
        {canEdit && !customerArchived && (
          <Link
            href={`/customers/${customerPageId}/complaints/new`}
            className="ml-auto rounded bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover"
          >
            クレームを登録
          </Link>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
              <th className="px-2 py-1.5 font-medium">発生日</th>
              <th className="px-2 py-1.5 font-medium">タイトル</th>
              <th className="px-2 py-1.5 font-medium">重要度</th>
              <th className="px-2 py-1.5 font-medium">対応責任者</th>
              <th className="px-2 py-1.5 font-medium">期限</th>
              <th className="px-2 py-1.5 font-medium">対応状況</th>
            </tr>
          </thead>
          <tbody>
            {complaints.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-slate-500"
                >
                  未解決のクレームはありません。
                  {canEdit && !customerArchived && (
                    <span className="ml-2">
                      <Link
                        href={`/customers/${customerPageId}/complaints/new`}
                        className="text-primary underline"
                      >
                        クレームを登録
                      </Link>
                    </span>
                  )}
                </td>
              </tr>
            )}
            {complaints.map((row) => (
              <tr
                key={row.notion_page_id}
                className="border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="px-2 py-1.5">{formatDate(row.occurred_on)}</td>
                <td className="max-w-48 truncate px-2 py-1.5 font-medium">
                  <Link
                    href={`/complaints/${row.notion_page_id}`}
                    className="text-primary hover:underline"
                  >
                    {row.title || "(無題)"}
                  </Link>
                </td>
                <td className="px-2 py-1.5">
                  {row.severity_id
                    ? (labels.severityNames.get(row.severity_id) ?? "—")
                    : "—"}
                </td>
                <td className="px-2 py-1.5">
                  {row.staff_page_id
                    ? (labels.staffNamesByPageId.get(row.staff_page_id) ?? "—")
                    : "—"}
                </td>
                <td className="px-2 py-1.5">{formatDate(row.due_date)}</td>
                <td className="px-2 py-1.5">
                  {row.status_id
                    ? (labels.statusNames.get(row.status_id) ?? "—")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
