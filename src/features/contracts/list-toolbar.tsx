import Link from "next/link";

import { FilterDisclosure } from "@/components/ui/filter-disclosure";
import type { ContractListQuery } from "@/lib/contracts/types";
import type { ListFilterOptions } from "@/features/contracts/list-data";

function countAdvanced(query: ContractListQuery): number {
  let n = 0;
  if (query.tradeTypeId) n += 1;
  if (query.paymentStatusId) n += 1;
  if (query.staffUserId) n += 1;
  if (query.amountMin != null) n += 1;
  if (query.amountMax != null) n += 1;
  if (query.contractedAtFrom) n += 1;
  if (query.contractedAtTo) n += 1;
  if (query.endDateFrom) n += 1;
  if (query.endDateTo) n += 1;
  return n;
}

export function ContractListToolbar({
  query,
  filters,
}: {
  query: ContractListQuery;
  filters: ListFilterOptions;
}) {
  const advanced = countAdvanced(query);
  return (
    <form
      method="get"
      className="flex flex-col gap-2 rounded border border-slate-200 bg-white p-2 text-xs"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">フリーワード</span>
          <input
            type="search"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="契約名・備考"
            className="h-7 w-52 rounded border border-slate-300 px-2"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">顧客</span>
          <select
            name="customer"
            defaultValue={query.customerPageId ?? ""}
            className="h-7 w-44 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.customers.map((c) => (
              <option key={c.pageId} value={c.pageId}>
                {c.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">状態</span>
          <select
            name="status"
            defaultValue={query.statusId ?? ""}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.statuses.map((s) => (
              <option key={s.pageId} value={s.pageId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-7 rounded border border-slate-300 bg-slate-100 px-3 hover:bg-slate-200"
        >
          検索
        </button>
        <Link
          href="/contracts"
          className="h-7 leading-7 text-slate-500 hover:text-slate-900"
        >
          クリア
        </Link>
      </div>
      <FilterDisclosure appliedCount={advanced}>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">取引区分</span>
          <select
            name="trade"
            defaultValue={query.tradeTypeId ?? ""}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.tradeTypes.map((s) => (
              <option key={s.pageId} value={s.pageId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">支払状況</span>
          <select
            name="payment"
            defaultValue={query.paymentStatusId ?? ""}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.paymentStatuses.map((s) => (
              <option key={s.pageId} value={s.pageId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">担当者</span>
          <select
            name="staff"
            defaultValue={query.staffUserId ?? ""}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.staff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">金額(以上)</span>
          <input
            type="number"
            name="amountMin"
            min={0}
            step={1}
            defaultValue={query.amountMin ?? ""}
            className="h-7 w-28 rounded border border-slate-300 px-2"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">金額(以下)</span>
          <input
            type="number"
            name="amountMax"
            min={0}
            step={1}
            defaultValue={query.amountMax ?? ""}
            className="h-7 w-28 rounded border border-slate-300 px-2"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">契約日(From)</span>
          <input
            type="date"
            name="contractedFrom"
            defaultValue={query.contractedAtFrom ?? ""}
            className="h-7 rounded border border-slate-300 px-1"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">契約日(To)</span>
          <input
            type="date"
            name="contractedTo"
            defaultValue={query.contractedAtTo ?? ""}
            className="h-7 rounded border border-slate-300 px-1"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">終了日(From)</span>
          <input
            type="date"
            name="endFrom"
            defaultValue={query.endDateFrom ?? ""}
            className="h-7 rounded border border-slate-300 px-1"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">終了日(To)</span>
          <input
            type="date"
            name="endTo"
            defaultValue={query.endDateTo ?? ""}
            className="h-7 rounded border border-slate-300 px-1"
          />
        </label>
      </FilterDisclosure>
      {query.statusSemantic && (
        <input type="hidden" name="semantic" value={query.statusSemantic} />
      )}
      {query.sort && <input type="hidden" name="sort" value={query.sort} />}
      {query.sortDir && (
        <input type="hidden" name="dir" value={query.sortDir} />
      )}
    </form>
  );
}
