import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import {
  fetchProspectListStats,
  listProspectLists,
} from "@/lib/prospects/lists";
import { formatDateTime } from "@/features/customers/format";
import { PageHeading } from "@/components/ui/page-heading";
import { EmptyState } from "@/components/ui/state-messages";
import {
  PROSPECT_LIST_STATUS_LABELS,
  PROSPECT_SOURCE_TYPE_LABELS,
} from "@/lib/prospects/presentation";

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
      <PageHeading
        title="営業リスト"
        description="候補企業の入手元や担当範囲ごとにまとめ、割当・架電・正式組織への登録を進める作業単位です。"
        supporting={
          <span>
            リストには、正式登録前・登録処理中・正式組織化済みの企業が含まれます。各企業の登録段階はリスト詳細で確認できます。
          </span>
        }
        actions={
          canManage ? (
            <Link
              href="/prospect-lists/new"
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
            >
              営業リストを作成
            </Link>
          ) : null
        }
      />
      {lists.length === 0 ? (
        <EmptyState
          title="営業リストはまだありません"
          hint="最初のリストを作成し、CSVなどから営業候補を追加してください。"
          actionHref={canManage ? "/prospect-lists/new" : undefined}
          actionLabel={canManage ? "最初の営業リストを作成" : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">リスト名</th>
                <th className="px-2 py-1.5 font-medium">入手元</th>
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
                      {PROSPECT_SOURCE_TYPE_LABELS[list.source_type]}
                      {list.source_name ? ` / ${list.source_name}` : ""}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                        <span aria-hidden="true">●</span>
                        {PROSPECT_LIST_STATUS_LABELS[list.status]}
                      </span>
                    </td>
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
