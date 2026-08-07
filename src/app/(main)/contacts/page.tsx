import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/require";
import { listContacts } from "@/lib/contacts/read-list";
import {
  CONTACT_LIST_PER_PAGE,
  buildContactListSearch,
  parseContactListParams,
} from "@/lib/contacts/list-params";
import type { ContactListSortKey } from "@/lib/contacts/types";
import {
  loadListFilterOptions,
  loadListLabelMaps,
} from "@/features/contacts/list-data";
import { ContactListToolbar } from "@/features/contacts/list-toolbar";
import { ClickableRow } from "@/features/customers/clickable-row";
import { formatDateTime, formatOptional } from "@/features/contacts/format";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

const SORTABLE: Partial<Record<string, ContactListSortKey>> = {
  氏名: "name",
  氏名よみ: "name_kana",
  部署: "department",
  役職: "title",
  更新日時: "updated_at",
};

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  let canEdit = false;
  try {
    const user = await requireUser();
    canEdit = hasPermission(user.role, "contact.edit");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const params = await searchParams;
  const { query, page } = parseContactListParams(params);

  const [{ rows, count }, filters] = await Promise.all([
    listContacts(query),
    loadListFilterOptions(),
  ]);
  const labels = await loadListLabelMaps(rows);

  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / CONTACT_LIST_PER_PAGE));
  const showingInactive = query.isActive === false;

  const sortHeader = (label: string) => {
    const key = SORTABLE[label];
    if (!key) {
      return <span>{label}</span>;
    }
    const nextDir =
      query.sort === key && query.sortDir !== "asc" ? "asc" : "desc";
    return (
      <Link
        href={`/contacts${buildContactListSearch(params, {
          sort: key,
          dir: nextDir,
          page: undefined,
        })}`}
        className="inline-flex items-center gap-0.5 hover:text-slate-900"
      >
        {label}
        {query.sort === key && (
          <span aria-hidden>{query.sortDir === "asc" ? "▲" : "▼"}</span>
        )}
      </Link>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">先方担当者一覧</h1>
        <span className="text-xs text-slate-500">
          {total}件{showingInactive ? "(無効のみ)" : ""}
        </span>
        {canEdit && (
          <Link
            href="/contacts/new"
            className="ml-auto rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
          >
            新規登録
          </Link>
        )}
      </div>

      <ContactListToolbar
        query={query}
        filters={filters}
        showingInactive={showingInactive}
      />

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full whitespace-nowrap text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
              <th className="px-2 py-1.5 font-medium">{sortHeader("氏名")}</th>
              <th className="px-2 py-1.5 font-medium">
                {sortHeader("氏名よみ")}
              </th>
              <th className="px-2 py-1.5 font-medium">所属顧客</th>
              <th className="px-2 py-1.5 font-medium">{sortHeader("部署")}</th>
              <th className="px-2 py-1.5 font-medium">{sortHeader("役職")}</th>
              <th className="px-2 py-1.5 font-medium">電話番号</th>
              <th className="px-2 py-1.5 font-medium">メール</th>
              <th className="px-2 py-1.5 font-medium">担当者区分</th>
              <th className="px-2 py-1.5 font-medium">状態</th>
              <th className="px-2 py-1.5 font-medium">
                {sortHeader("更新日時")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-10 text-center text-slate-500"
                >
                  {query.q || query.customerPageId || query.contactTypeId
                    ? "条件に一致する担当者がありません。条件を変更してください。"
                    : "先方担当者が登録されていません。"}
                  {canEdit && !showingInactive && (
                    <span className="ml-2">
                      <Link
                        href="/contacts/new"
                        className="text-primary underline"
                      >
                        新規登録
                      </Link>
                    </span>
                  )}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <ClickableRow
                key={row.notion_page_id}
                href={`/contacts/${row.notion_page_id}`}
              >
                <td className="max-w-40 truncate px-2 py-1.5 font-medium">
                  <Link
                    href={`/contacts/${row.notion_page_id}`}
                    className="text-primary hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="max-w-32 truncate px-2 py-1.5">
                  {formatOptional(row.name_kana)}
                </td>
                <td className="max-w-48 truncate px-2 py-1.5">
                  {row.customer_page_id ? (
                    <Link
                      href={`/customers/${row.customer_page_id}`}
                      className="text-primary hover:underline"
                    >
                      {labels.customerNames.get(row.customer_page_id) ?? "(不明)"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-32 truncate px-2 py-1.5">
                  {formatOptional(row.department)}
                </td>
                <td className="max-w-28 truncate px-2 py-1.5">
                  {formatOptional(row.title)}
                </td>
                <td className="px-2 py-1.5">{formatOptional(row.phone)}</td>
                <td className="max-w-48 truncate px-2 py-1.5">
                  {formatOptional(row.email)}
                </td>
                <td className="px-2 py-1.5">
                  {row.contact_type_id
                    ? (labels.contactTypeNames.get(row.contact_type_id) ?? "—")
                    : "—"}
                </td>
                <td className="px-2 py-1.5">
                  {row.is_active ? (
                    <span className="text-slate-400">有効</span>
                  ) : (
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">
                      無効
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {formatDateTime(row.updated_at)}
                </td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-xs text-slate-600">
        <span>
          {total === 0
            ? "0件"
            : `${(page - 1) * CONTACT_LIST_PER_PAGE + 1}-${Math.min(
                page * CONTACT_LIST_PER_PAGE,
                total,
              )} / ${total}件`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={`/contacts${buildContactListSearch(params, {
                page: String(page - 1),
              })}`}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            >
              前へ
            </Link>
          ) : (
            <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">
              前へ
            </span>
          )}
          <span>
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`/contacts${buildContactListSearch(params, {
                page: String(page + 1),
              })}`}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            >
              次へ
            </Link>
          ) : (
            <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">
              次へ
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
