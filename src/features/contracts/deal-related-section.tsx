import Link from "next/link";

import type { ContractIndexRow } from "@/lib/contracts/types";
import {
  formatPeriod,
  formatYen,
} from "@/features/contracts/format";
import type { ListLabelMaps } from "@/features/contracts/list-data";

export function DealContractsSection({
  dealPageId,
  customerPageId,
  contracts,
  labels,
  canEdit,
}: {
  dealPageId: string;
  customerPageId: string | null;
  contracts: ContractIndexRow[];
  labels: ListLabelMaps;
  canEdit: boolean;
}) {
  return (
    <section className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <h2 className="text-xs font-bold text-slate-700">関連契約</h2>
        <span className="text-xs text-slate-500">{contracts.length}件</span>
        {canEdit && customerPageId && (
          <Link
            href={`/deals/${dealPageId}/contracts/new`}
            className="ml-auto rounded bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover"
          >
            契約を追加
          </Link>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
              <th className="px-2 py-1.5 font-medium">契約名</th>
              <th className="px-2 py-1.5 font-medium">金額</th>
              <th className="px-2 py-1.5 font-medium">期間</th>
              <th className="px-2 py-1.5 font-medium">支払状況</th>
              <th className="px-2 py-1.5 font-medium">状態</th>
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-slate-500"
                >
                  この案件の契約はありません。
                  {canEdit && customerPageId && (
                    <span className="ml-2">
                      <Link
                        href={`/deals/${dealPageId}/contracts/new`}
                        className="text-primary underline"
                      >
                        契約を追加
                      </Link>
                    </span>
                  )}
                </td>
              </tr>
            )}
            {contracts.slice(0, 20).map((row) => (
              <tr
                key={row.notion_page_id}
                className="border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="max-w-48 truncate px-2 py-1.5 font-medium">
                  <Link
                    href={`/contracts/${row.notion_page_id}`}
                    className="text-primary hover:underline"
                  >
                    {row.title || "(無題)"}
                  </Link>
                </td>
                <td className="px-2 py-1.5">{formatYen(row.amount)}</td>
                <td className="px-2 py-1.5">
                  {formatPeriod(row.start_date, row.end_date)}
                </td>
                <td className="px-2 py-1.5">
                  {row.payment_status_id
                    ? (labels.paymentStatusNames.get(row.payment_status_id) ??
                      "—")
                    : "—"}
                </td>
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
