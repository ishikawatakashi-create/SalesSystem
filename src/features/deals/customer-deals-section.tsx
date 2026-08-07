import Link from "next/link";

import { CompactEmptyState } from "@/components/ui/compact-empty-state";
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
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-2.5 py-1.5">
        <h2 className="text-xs font-bold text-slate-700">案件</h2>
        <span className="text-xs text-slate-500">{deals.length}件</span>
        <span className="text-xs text-slate-500">
          見込み金額: {formatYen(expectedAmount)}
          <span className="ml-1 text-[10px] text-slate-400">
            進行中・保留から集計
          </span>
        </span>
        {canEditDeal && !customerArchived && deals.length > 0 && (
          <Link
            href={`/customers/${customerPageId}/deals/new`}
            className="ml-auto text-xs text-slate-600 underline-offset-2 hover:underline"
          >
            追加
          </Link>
        )}
      </div>
      {deals.length === 0 ? (
        <div className="px-2.5 py-1.5">
          <CompactEmptyState
            message="案件はまだありません。"
            actionHref={
              canEditDeal && !customerArchived
                ? `/customers/${customerPageId}/deals/new`
                : undefined
            }
            actionLabel={
              canEditDeal && !customerArchived ? "案件を追加" : undefined
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
                <th className="px-2 py-1 font-medium">案件名</th>
                <th className="px-2 py-1 font-medium">ステージ</th>
                <th className="px-2 py-1 font-medium">ステータス</th>
                <th className="px-2 py-1 font-medium">見込み金額</th>
                <th className="px-2 py-1 font-medium">顧客担当者</th>
                <th className="px-2 py-1 font-medium">自社担当者</th>
                <th className="px-2 py-1 font-medium">見込みクローズ日</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((row) => (
                <tr
                  key={row.notion_page_id}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="max-w-48 truncate px-2 py-1 font-medium">
                    <Link
                      href={`/deals/${row.notion_page_id}`}
                      className="text-primary hover:underline"
                    >
                      {row.title || "(無題)"}
                    </Link>
                  </td>
                  <td className="px-2 py-1">
                    {row.stage_id
                      ? (labels.stageNames.get(row.stage_id) ?? "—")
                      : "—"}
                  </td>
                  <td className="px-2 py-1">
                    {row.status_id
                      ? (labels.statusNames.get(row.status_id) ?? "—")
                      : "—"}
                  </td>
                  <td className="px-2 py-1">
                    {formatYen(row.expected_amount)}
                  </td>
                  <td className="max-w-36 truncate px-2 py-1">
                    {joinNames(row.contact_page_ids ?? [], labels.contactNames)}
                  </td>
                  <td className="max-w-36 truncate px-2 py-1">
                    {joinNames(
                      row.staff_page_ids ?? [],
                      labels.staffNamesByPageId,
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {formatDate(row.expected_close_date)}
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
