import Link from "next/link";

import type { DealIndexRow } from "@/lib/deals/types";
import {
  formatDate,
  formatYen,
} from "@/features/deals/format";
import type { ListLabelMaps } from "@/features/deals/list-data";

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

export function CustomerDealsSection({
  customerPageId,
  deals,
  labels,
  canEditDeal,
  customerArchived,
  expectedAmount,
}: {
  customerPageId: string;
  deals: DealIndexRow[];
  labels: ListLabelMaps;
  canEditDeal: boolean;
  customerArchived: boolean;
  expectedAmount: number | null;
}) {
  return (
    <section className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <h2 className="text-xs font-bold text-slate-700">案件</h2>
        <span className="text-xs text-slate-500">{deals.length}件</span>
        <span className="text-xs text-slate-500">
          見込み金額: {formatYen(expectedAmount)}
          <span className="ml-1 text-[10px] text-slate-400">
            進行中・保留案件から自動集計
          </span>
        </span>
        {canEditDeal && !customerArchived && (
          <Link
            href={`/customers/${customerPageId}/deals/new`}
            className="ml-auto rounded bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover"
          >
            案件を追加
          </Link>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
              <th className="px-2 py-1.5 font-medium">案件名</th>
              <th className="px-2 py-1.5 font-medium">ステージ</th>
              <th className="px-2 py-1.5 font-medium">ステータス</th>
              <th className="px-2 py-1.5 font-medium">見込み金額</th>
              <th className="px-2 py-1.5 font-medium">顧客担当者</th>
              <th className="px-2 py-1.5 font-medium">自社担当者</th>
              <th className="px-2 py-1.5 font-medium">見込みクローズ日</th>
            </tr>
          </thead>
          <tbody>
            {deals.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-slate-500"
                >
                  案件は登録されていません。
                  {canEditDeal && !customerArchived && (
                    <span className="ml-2">
                      <Link
                        href={`/customers/${customerPageId}/deals/new`}
                        className="text-primary underline"
                      >
                        案件を追加
                      </Link>
                    </span>
                  )}
                </td>
              </tr>
            )}
            {deals.map((row) => (
              <tr
                key={row.notion_page_id}
                className="border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="max-w-48 truncate px-2 py-1.5 font-medium">
                  <Link
                    href={`/deals/${row.notion_page_id}`}
                    className="text-primary hover:underline"
                  >
                    {row.title || "(無題)"}
                  </Link>
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
                <td className="max-w-36 truncate px-2 py-1.5">
                  {joinNames(row.contact_page_ids ?? [], labels.contactNames)}
                </td>
                <td className="max-w-36 truncate px-2 py-1.5">
                  {joinNames(
                    row.staff_page_ids ?? [],
                    labels.staffNamesByPageId,
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {formatDate(row.expected_close_date)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
