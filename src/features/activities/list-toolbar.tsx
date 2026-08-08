import Link from "next/link";

import { FilterDisclosure } from "@/components/ui/filter-disclosure";
import type { ActivityListQuery } from "@/lib/activities/types";
import type { ListFilterOptions } from "@/features/activities/list-data";

function countAdvanced(query: ActivityListQuery): number {
  let n = 0;
  if (query.contactPageId) n += 1;
  if (query.dealPageId) n += 1;
  if (query.categoryId) n += 1;
  if (query.createdBy) n += 1;
  if (query.activityAtFrom) n += 1;
  if (query.activityAtTo) n += 1;
  return n;
}

export function ActivityListToolbar({
  query,
  filters,
}: {
  query: ActivityListQuery;
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
            placeholder="タイトル・要約"
            className="h-7 w-52 rounded border border-slate-300 px-2"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">組織</span>
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
        <button
          type="submit"
          className="h-7 rounded border border-slate-300 bg-slate-100 px-3 hover:bg-slate-200"
        >
          検索
        </button>
        <Link
          href="/activities"
          className="h-7 leading-7 text-slate-500 hover:text-slate-900"
        >
          クリア
        </Link>
      </div>
      <FilterDisclosure appliedCount={advanced}>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">担当者</span>
          <select
            name="contact"
            defaultValue={query.contactPageId ?? ""}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.contacts.map((c) => (
              <option key={c.pageId} value={c.pageId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">案件</span>
          <select
            name="deal"
            defaultValue={query.dealPageId ?? ""}
            className="h-7 w-40 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.deals.map((d) => (
              <option key={d.pageId} value={d.pageId}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">分類</span>
          <select
            name="category"
            defaultValue={query.categoryId ?? ""}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.categories.map((c) => (
              <option key={c.pageId} value={c.pageId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">登録者</span>
          <select
            name="createdBy"
            defaultValue={query.createdBy ?? ""}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.createdByUsers.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">対応日時(From)</span>
          <input
            type="date"
            name="from"
            defaultValue={query.activityAtFrom?.slice(0, 10) ?? ""}
            className="h-7 rounded border border-slate-300 px-1"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">対応日時(To)</span>
          <input
            type="date"
            name="to"
            defaultValue={query.activityAtTo?.slice(0, 10) ?? ""}
            className="h-7 rounded border border-slate-300 px-1"
          />
        </label>
      </FilterDisclosure>
      {query.sort && <input type="hidden" name="sort" value={query.sort} />}
      {query.sortDir && (
        <input type="hidden" name="dir" value={query.sortDir} />
      )}
    </form>
  );
}
