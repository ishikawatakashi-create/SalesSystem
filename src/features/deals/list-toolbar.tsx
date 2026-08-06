import Link from "next/link";

import type { DealListQuery } from "@/lib/deals/types";
import type { ListFilterOptions } from "@/features/deals/list-data";

export function DealListToolbar({
  query,
  filters,
}: {
  query: DealListQuery;
  filters: ListFilterOptions;
}) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-2 text-xs"
    >
      <label className="flex flex-col gap-0.5">
        <span className="text-slate-500">フリーワード</span>
        <input
          type="search"
          name="q"
          defaultValue={query.q ?? ""}
          placeholder="案件名・商材"
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
        <span className="text-slate-500">ステージ</span>
        <select
          name="stage"
          defaultValue={query.stageId ?? ""}
          className="h-7 w-36 rounded border border-slate-300 px-1"
        >
          <option value="">すべて</option>
          {filters.stages.map((s) => (
            <option key={s.pageId} value={s.pageId}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-slate-500">ステータス</span>
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
      <label className="flex flex-col gap-0.5">
        <span className="text-slate-500">自社担当者</span>
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
        <span className="text-slate-500">見込み金額(以上)</span>
        <input
          type="number"
          name="amountMin"
          min={0}
          step={1}
          defaultValue={query.expectedAmountMin ?? ""}
          className="h-7 w-28 rounded border border-slate-300 px-2"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-slate-500">見込み金額(以下)</span>
        <input
          type="number"
          name="amountMax"
          min={0}
          step={1}
          defaultValue={query.expectedAmountMax ?? ""}
          className="h-7 w-28 rounded border border-slate-300 px-2"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-slate-500">受注予定日(From)</span>
        <input
          type="date"
          name="closeFrom"
          defaultValue={query.expectedCloseDateFrom ?? ""}
          className="h-7 rounded border border-slate-300 px-1"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-slate-500">受注予定日(To)</span>
        <input
          type="date"
          name="closeTo"
          defaultValue={query.expectedCloseDateTo ?? ""}
          className="h-7 rounded border border-slate-300 px-1"
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
      {query.sort && <input type="hidden" name="sort" value={query.sort} />}
      {query.sortDir && (
        <input type="hidden" name="dir" value={query.sortDir} />
      )}
      <button
        type="submit"
        className="h-7 rounded border border-slate-300 bg-slate-100 px-3 hover:bg-slate-200"
      >
        検索
      </button>
      <Link
        href="/deals"
        className="h-7 leading-7 text-slate-500 hover:text-slate-900"
      >
        クリア
      </Link>
    </form>
  );
}
