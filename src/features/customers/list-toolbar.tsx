import Link from "next/link";

import { FilterDisclosure } from "@/components/ui/filter-disclosure";
import type { CustomerListQuery } from "@/lib/customers/types";
import type { ListFilterOptions } from "@/features/customers/list-data";

function countAdvanced(query: CustomerListQuery): number {
  let n = 0;
  if (query.businessCategoryId) n += 1;
  if (query.staffUserId) n += 1;
  if (query.prefecture) n += 1;
  if (query.isArchived === true) n += 1;
  return n;
}

export function CustomerListToolbar({
  query,
  filters,
  showingArchived,
}: {
  query: CustomerListQuery;
  filters: ListFilterOptions;
  showingArchived: boolean;
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
            placeholder="名称・かな・電話・メール"
            className="h-7 w-52 rounded border border-slate-300 px-2"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">営業ステータス</span>
          <select
            name="status"
            defaultValue={query.salesStatusId ?? ""}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.salesStatuses.map((s) => (
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
          href="/customers"
          className="h-7 leading-7 text-slate-500 hover:text-slate-900"
        >
          クリア
        </Link>
      </div>
      <FilterDisclosure appliedCount={advanced}>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">事業区分</span>
          <select
            name="category"
            defaultValue={query.businessCategoryId ?? ""}
            className="h-7 w-40 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.businessCategories.map((c) => (
              <option key={c.pageId} value={c.pageId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">担当者</span>
          <select
            name="staff"
            defaultValue={query.staffUserId ?? ""}
            className="h-7 w-32 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.staff.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">都道府県</span>
          <select
            name="pref"
            defaultValue={query.prefecture ?? ""}
            className="h-7 w-28 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.prefectures.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-7 items-center gap-1">
          <input
            type="checkbox"
            name="archived"
            value="1"
            defaultChecked={showingArchived}
          />
          <span>アーカイブ済みを表示</span>
        </label>
      </FilterDisclosure>
      {query.sort && <input type="hidden" name="sort" value={query.sort} />}
      {query.sortDir && (
        <input type="hidden" name="dir" value={query.sortDir} />
      )}
    </form>
  );
}
