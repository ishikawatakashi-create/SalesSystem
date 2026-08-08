import Link from "next/link";

import { FilterDisclosure } from "@/components/ui/filter-disclosure";
import type { ContactListQuery } from "@/lib/contacts/types";
import type { ListFilterOptions } from "@/features/contacts/list-data";

function countAdvanced(query: ContactListQuery): number {
  let n = 0;
  if (query.contactTypeId) n += 1;
  if (query.isActive === false) n += 1;
  return n;
}

export function ContactListToolbar({
  query,
  filters,
  showingInactive,
}: {
  query: ContactListQuery;
  filters: ListFilterOptions;
  showingInactive: boolean;
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
            placeholder="氏名・よみ・電話・メール"
            className="h-7 w-52 rounded border border-slate-300 px-2"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">所属組織</span>
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
          href="/contacts"
          className="h-7 leading-7 text-slate-500 hover:text-slate-900"
        >
          クリア
        </Link>
      </div>
      <FilterDisclosure appliedCount={advanced}>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">担当者区分</span>
          <select
            name="type"
            defaultValue={query.contactTypeId ?? ""}
            className="h-7 w-36 rounded border border-slate-300 px-1"
          >
            <option value="">すべて</option>
            {filters.contactTypes.map((t) => (
              <option key={t.pageId} value={t.pageId}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-7 items-center gap-1">
          <input
            type="checkbox"
            name="inactive"
            value="1"
            defaultChecked={showingInactive}
          />
          <span>無効のみ表示</span>
        </label>
      </FilterDisclosure>
      {query.sort && <input type="hidden" name="sort" value={query.sort} />}
      {query.sortDir && (
        <input type="hidden" name="dir" value={query.sortDir} />
      )}
    </form>
  );
}
