import Link from "next/link";

import { FilterDisclosure } from "@/components/ui/filter-disclosure";
import {
  buildActionListSearch,
  type ActionListView,
} from "@/lib/actions/list-params";
import type { ActionListQuery } from "@/lib/actions/types";
import type { ListFilterOptions } from "@/features/actions/list-data";

type RawParams = Record<string, string | string[] | undefined>;

const TABS: { view: ActionListView; label: string }[] = [
  { view: "today-overdue", label: "今日・期限超過" },
  { view: "upcoming", label: "今後" },
  { view: "done", label: "完了" },
  { view: "all", label: "すべて" },
];

export function ActionListTabs({
  view,
  params,
}: {
  view: ActionListView;
  params: RawParams;
}) {
  return (
    <div className="flex flex-wrap gap-1 text-xs">
      {TABS.map((t) => {
        const href = `/actions${buildActionListSearch(params, {
          view: t.view === "today-overdue" ? undefined : t.view,
          page: undefined,
          open: undefined,
          dueFrom: undefined,
          dueTo: undefined,
        })}`;
        const active = view === t.view;
        return (
          <Link
            key={t.view}
            href={href}
            className={
              active
                ? "rounded bg-slate-800 px-2.5 py-1 font-medium text-white"
                : "rounded border border-slate-300 bg-white px-2.5 py-1 text-slate-600 hover:bg-slate-50"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

function countAdvanced(query: ActionListQuery): number {
  let n = 0;
  if (query.dealPageId) n += 1;
  if (query.staffPageId) n += 1;
  if (query.statusId) n += 1;
  if (query.dueDateFrom) n += 1;
  if (query.dueDateTo) n += 1;
  return n;
}

export function ActionListToolbar({
  query,
  filters,
  view,
}: {
  query: ActionListQuery;
  filters: ListFilterOptions;
  view: ActionListView;
}) {
  const advanced = countAdvanced(query);
  return (
    <form
      method="get"
      className="flex flex-col gap-2 rounded border border-slate-200 bg-white p-2 text-xs"
    >
      <input type="hidden" name="view" value={view} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">フリーワード</span>
          <input
            type="search"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="アクション内容"
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
          <span className="text-slate-500">担当</span>
          <select
            name="assignee"
            defaultValue={query.assigneeUserId ?? ""}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.assignees.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.name}
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
          href={view === "today-overdue" ? "/actions" : `/actions?view=${view}`}
          className="h-7 leading-7 text-slate-500 hover:text-slate-900"
        >
          クリア
        </Link>
      </div>
      <FilterDisclosure appliedCount={advanced}>
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
          <span className="text-slate-500">自社担当者</span>
          <select
            name="staff"
            defaultValue={query.staffPageId ?? ""}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.staff.map((s) => (
              <option key={s.pageId} value={s.pageId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">状態</span>
          <select
            name="status"
            defaultValue={query.statusId ?? ""}
            className="h-7 w-32 rounded border border-slate-300 px-1"
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
      {query.sort && <input type="hidden" name="sort" value={query.sort} />}
      {query.sortDir && (
        <input type="hidden" name="dir" value={query.sortDir} />
      )}
    </form>
  );
}
