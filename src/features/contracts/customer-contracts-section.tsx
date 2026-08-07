import Link from "next/link";

import { CompactEmptyState } from "@/components/ui/compact-empty-state";
import type { ContractIndexRow } from "@/lib/contracts/types";
import {
  formatPeriod,
  formatYen,
} from "@/features/contracts/format";
import type { ListLabelMaps } from "@/features/contracts/list-data";

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

export function CustomerContractsSection({
  customerPageId,
  contracts,
  labels,
  canEdit,
  customerArchived,
}: {
  customerPageId: string;
  contracts: ContractIndexRow[];
  labels: ListLabelMaps;
  canEdit: boolean;
  customerArchived: boolean;
}) {
  return (
    <section className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-2.5 py-1.5">
        <h2 className="text-xs font-bold text-slate-700">有効契約</h2>
        <span className="text-xs text-slate-500">{contracts.length}件</span>
        <Link
          href={`/contracts?customer=${customerPageId}`}
          className="text-xs text-slate-600 underline-offset-2 hover:underline"
        >
          すべて見る
        </Link>
        {canEdit && !customerArchived && contracts.length > 0 && (
          <Link
            href={`/customers/${customerPageId}/contracts/new`}
            className="ml-auto text-xs text-slate-600 underline-offset-2 hover:underline"
          >
            追加
          </Link>
        )}
      </div>
      {contracts.length === 0 ? (
        <div className="px-2.5 py-1.5">
          <CompactEmptyState
            message="有効な契約はありません。"
            actionHref={
              canEdit && !customerArchived
                ? `/customers/${customerPageId}/contracts/new`
                : undefined
            }
            actionLabel={
              canEdit && !customerArchived ? "契約を追加" : undefined
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
                <th className="px-2 py-1 font-medium">契約名</th>
                <th className="px-2 py-1 font-medium">区分</th>
                <th className="px-2 py-1 font-medium">金額</th>
                <th className="px-2 py-1 font-medium">期間</th>
                <th className="px-2 py-1 font-medium">支払状況</th>
                <th className="px-2 py-1 font-medium">状態</th>
                <th className="px-2 py-1 font-medium">担当者</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((row) => (
                <tr
                  key={row.notion_page_id}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="max-w-48 truncate px-2 py-1 font-medium">
                    <Link
                      href={`/contracts/${row.notion_page_id}`}
                      className="text-primary hover:underline"
                    >
                      {row.title || "(無題)"}
                    </Link>
                  </td>
                  <td className="px-2 py-1">
                    {row.contract_type_id
                      ? (labels.contractTypeNames.get(row.contract_type_id) ??
                        "—")
                      : "—"}
                  </td>
                  <td className="px-2 py-1">{formatYen(row.amount)}</td>
                  <td className="px-2 py-1">
                    {formatPeriod(row.start_date, row.end_date)}
                  </td>
                  <td className="px-2 py-1">
                    {row.payment_status_id
                      ? (labels.paymentStatusNames.get(row.payment_status_id) ??
                        "—")
                      : "—"}
                  </td>
                  <td className="px-2 py-1">
                    {row.status_id
                      ? (labels.statusNames.get(row.status_id) ?? "—")
                      : "—"}
                  </td>
                  <td className="max-w-36 truncate px-2 py-1">
                    {joinNames(
                      row.staff_page_ids ?? [],
                      labels.staffNamesByPageId,
                    )}
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
