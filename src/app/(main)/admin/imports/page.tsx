import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ENTITY_DISPLAY_NAMES, type ImportEntity } from "@/lib/csv/entities";

export default async function AdminImportsPage() {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "csv.import")) redirect("/");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const user = await requireUser();
  const admin = createAdminClient();
  let q = admin
    .from("import_jobs")
    .select(
      "id,file_name,entity_type,status,row_count,created_at,updated_at,preview_summary,summary",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (user.role !== "admin") {
    q = q.eq("created_by", user.id);
  }
  const { data: jobs } = await q;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold">CSV取込</h1>
          <p className="text-xs text-slate-500">
            既存データの移行。ブラウザを閉じてもジョブは継続します。
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link
            href="/admin/imports/templates"
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
          >
            テンプレート
          </Link>
          <Link
            href="/admin/imports/new"
            className="rounded bg-slate-800 px-3 py-1.5 text-white hover:bg-slate-700"
          >
            新規取込
          </Link>
        </div>
      </div>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">ファイル</th>
              <th className="px-3 py-2">対象</th>
              <th className="px-3 py-2">状態</th>
              <th className="px-3 py-2">行数</th>
              <th className="px-3 py-2">作成</th>
            </tr>
          </thead>
          <tbody>
            {(jobs ?? []).map((job) => (
              <tr key={job.id as string} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/imports/${job.id}`}
                    className="text-slate-800 underline"
                  >
                    {String(job.file_name ?? "(unnamed)")}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {ENTITY_DISPLAY_NAMES[job.entity_type as ImportEntity] ??
                    String(job.entity_type ?? "-")}
                </td>
                <td className="px-3 py-2">{String(job.status)}</td>
                <td className="px-3 py-2">{String(job.row_count ?? "-")}</td>
                <td className="px-3 py-2">
                  {job.created_at
                    ? new Date(String(job.created_at)).toLocaleString("ja-JP")
                    : "-"}
                </td>
              </tr>
            ))}
            {(jobs ?? []).length === 0 && (
              <tr>
                <td className="px-3 py-6 text-slate-500" colSpan={5}>
                  まだ取込ジョブがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
