import Link from "next/link";

import { FilterDisclosure } from "@/components/ui/filter-disclosure";
import type { ComplaintListQuery } from "@/lib/complaints/types";
import type { ListFilterOptions } from "@/features/complaints/list-data";

function countAdvanced(query: ComplaintListQuery): number {
  let n = 0;
  if (query.severityId) n += 1;
  if (query.statusId) n += 1;
  if (query.staffUserId) n += 1;
  if (query.occurredOnFrom) n += 1;
  if (query.occurredOnTo) n += 1;
  if (query.dueDateFrom) n += 1;
  if (query.dueDateTo) n += 1;
  return n;
}

export function ComplaintListToolbar({
  query,
  filters,
}: {
  query: ComplaintListQuery;
  filters: ListFilterOptions;
}) {
  const unresolvedValue = query.unresolvedOnly ? "1" : "0";
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
            placeholder="タイトル・概要"
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
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">表示</span>
          <select
            name="unresolved"
            defaultValue={unresolvedValue}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="1">未解決のみ</option>
            <option value="0">すべて</option>
          </select>
        </label>
        <button
          type="submit"
          className="h-7 rounded border border-slate-300 bg-slate-100 px-3 hover:bg-slate-200"
        >
          検索
        </button>
        <Link
          href="/complaints"
          className="h-7 leading-7 text-slate-500 hover:text-slate-900"
        >
          クリア
        </Link>
      </div>
      <FilterDisclosure appliedCount={advanced}>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">重要度</span>
          <select
            name="severity"
            defaultValue={query.severityId ?? ""}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.severities.map((s) => (
              <option key={s.pageId} value={s.pageId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">対応状況</span>
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
          <span className="text-slate-500">対応責任者</span>
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
          <span className="text-slate-500">発生日(From)</span>
          <input
            type="date"
            name="occurredFrom"
            defaultValue={query.occurredOnFrom ?? ""}
            className="h-7 rounded border border-slate-300 px-1"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">発生日(To)</span>
          <input
            type="date"
            name="occurredTo"
            defaultValue={query.occurredOnTo ?? ""}
            className="h-7 rounded border border-slate-300 px-1"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">期限(From)</span>
          <input
            type="date"
            name="dueFrom"
            defaultValue={query.dueDateFrom ?? ""}
            className="h-7 rounded border border-slate-300 px-1"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">期限(To)</span>
          <input
            type="date"
            name="dueTo"
            defaultValue={query.dueDateTo ?? ""}
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