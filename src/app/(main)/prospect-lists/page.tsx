import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import {
  fetchProspectListStats,
  listProspectLists,
} from "@/lib/prospects/lists";
import { CompactEmptyState } from "@/components/ui/compact-empty-state";
import { formatDateTime } from "@/features/customers/format";

export const dynamic = "force-dynamic";

export default async function ProspectListsPage() {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "prospect.view");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const canManage = hasPermission(user.role, "prospect.manage_lists");
  const lists = await listProspectLists();
  const stats = await fetchProspectListStats(lists.map((l) => l.id));

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-base font-bold">営業リスト</h1>
        {canManage ? (
          <Link
            href="/prospect-lists/new"
            className="rounded bg-slate-800 px-2 py-1 text-xs text-white"
          >
            営業リストを作成
          </Link>
        ) : null}
      </div>
      <p className="text-xs text-slate-500">
        未精査の営業候補は Supabase で管理します。正式組織（Notion）とは別です。
      </p>
      {lists.length === 0 ? (
        <CompactEmptyState message="営業リストはまだありません。" />
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">リスト名</th>
                <th className="px-2 py-1.5 font-medium">source</th>
                <th className="px-2 py-1.5 font-medium">状態</th>
                <th className="px-2 py-1.5 font-medium">総件数</th>
                <th className="px-2 py-1.5 font-medium">未割当</th>
                <th className="px-2 py-1.5 font-medium">割当済</th>
                <th className="px-2 py-1.5 font-medium">対応中</th>
                <th className="px-2 py-1.5 font-medium">見込</th>
                <th className="px-2 py-1.5 font-medium">対象外</th>
                <th className="px-2 py-1.5 font-medium">更新</th>
              </tr>
            </thead>
            <tbody>
              {lists.map((list) => {
                const s = stats.get(list.id);
                return (
                  <tr
                    key={list.id}
                    className="border-t border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-2 py-1.5">
                      <Link
                        href={`/prospect-lists/${list.id}`}
                        className="font-medium text-primary underline"
                      >
                        {list.name}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {list.source_type}
                      {list.source_name ? ` / ${list.source_name}` : ""}
                    </td>
                    <td className="px-2 py-1.5">{list.status}</td>
                    <td className="px-2 py-1.5">{s?.total_count ?? 0}</td>
                    <td className="px-2 py-1.5">{s?.unassigned_count ?? 0}</td>
                    <td className="px-2 py-1.5">{s?.assigned_count ?? 0}</td>
                    <td className="px-2 py-1.5">{s?.working_count ?? 0}</td>
                    <td className="px-2 py-1.5">{s?.qualified_count ?? 0}</td>
                    <td className="px-2 py-1.5">
                      {s?.disqualified_count ?? 0}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                      {formatDateTime(list.updated_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
