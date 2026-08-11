import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ENTITY_DISPLAY_NAMES, type ImportEntity } from "@/lib/csv/entities";
import { getEntityFields } from "@/lib/csv/mapping";
import {
  adminStatusBadgeClass,
  importJobStatusPresentation,
} from "@/lib/admin-presentation";
import { ImportDetailClient } from "./import-detail-client";

export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let user;
  try {
    user = await requireUser();
    if (!hasPermission(user.role, "csv.import")) redirect("/");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const admin = createAdminClient();
  const { data: job } = await admin
    .from("import_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();
  if (job.created_by !== user.id && user.role !== "admin") redirect("/");

  const entity = job.entity_type as ImportEntity;
  const fields = getEntityFields(entity).filter((f) => f.kind !== "unsupported");
  const headers =
    ((job.summary as { headers?: string[] } | null)?.headers ??
      Object.keys((job.column_mapping as Record<string, unknown>) ?? {})) ||
    [];

  const { count: imported } = await admin
    .from("import_rows")
    .select("id", { count: "exact", head: true })
    .eq("import_job_id", id)
    .eq("status", "imported");
  const { count: failed } = await admin
    .from("import_rows")
    .select("id", { count: "exact", head: true })
    .eq("import_job_id", id)
    .eq("status", "import_failed");
  const { count: pending } = await admin
    .from("import_rows")
    .select("id", { count: "exact", head: true })
    .eq("import_job_id", id)
    .in("status", ["valid_new", "valid_update", "pending", "importing"]);
  const { count: skipped } = await admin
    .from("import_rows")
    .select("id", { count: "exact", head: true })
    .eq("import_job_id", id)
    .eq("status", "skipped");
  const { count: invalid } = await admin
    .from("import_rows")
    .select("id", { count: "exact", head: true })
    .eq("import_job_id", id)
    .eq("status", "invalid");

  const { data: errorRows } = await admin
    .from("import_rows")
    .select("row_number,status,error_message,reason_codes")
    .eq("import_job_id", id)
    .in("status", ["invalid", "import_failed"])
    .order("row_number", { ascending: true })
    .limit(50);

  const total = Number(job.row_count ?? 0);
  const done = (imported ?? 0) + (failed ?? 0) + (skipped ?? 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const status = importJobStatusPresentation(String(job.status));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/imports" className="text-xs text-slate-500">
            ← CSV取込一覧
          </Link>
          <h1 className="text-base font-bold">
            {String(job.file_name ?? "（ファイル名なし）")}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">
              {ENTITY_DISPLAY_NAMES[entity] ?? "取込対象を確認してください"}
            </span>
            <span className={adminStatusBadgeClass(status.tone)}>
              {status.label}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 rounded border border-slate-200 bg-white p-4 text-xs sm:grid-cols-4">
        <div>
          <div className="text-slate-500">総行数</div>
          <div className="text-lg font-semibold">{total}</div>
        </div>
        <div>
          <div className="text-slate-500">完了</div>
          <div className="text-lg font-semibold">{imported ?? 0}</div>
        </div>
        <div>
          <div className="text-slate-500">失敗 / 無効</div>
          <div className="text-lg font-semibold">
            {(failed ?? 0) + (invalid ?? 0)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">進捗</div>
          <div className="text-lg font-semibold">{pct}%</div>
        </div>
        <div className="text-slate-500 sm:col-span-4">
          未処理・処理中: {pending ?? 0}件 / 対象外: {skipped ?? 0}件 / 最終処理:{" "}
          {job.last_processed_at
            ? new Date(String(job.last_processed_at)).toLocaleString("ja-JP")
            : "-"}
        </div>
        {job.cancel_requested_at && (
          <div className="sm:col-span-4 text-amber-700">
            キャンセル要求済み。未処理行は停止し、成功済み行はロールバックしません。
          </div>
        )}
      </div>

      <details className="rounded border border-slate-200 bg-white text-xs text-slate-600">
        <summary className="cursor-pointer px-3 py-2 font-medium">
          技術情報
        </summary>
        <dl className="grid gap-2 border-t border-slate-100 px-3 py-2 sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">取込状態コード</dt>
            <dd className="font-mono">{String(job.status)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">取込処理ID</dt>
            <dd className="break-all font-mono">{id}</dd>
          </div>
        </dl>
      </details>

      <ImportDetailClient
        importJobId={id}
        status={String(job.status)}
        headers={headers}
        fields={fields.map((f) => ({
          key: f.key,
          labelJa: f.labelJa,
          required: f.required,
        }))}
        mapping={(job.column_mapping as Record<string, string | null>) ?? {}}
        previewSummary={(job.preview_summary as Record<string, number>) ?? {}}
        errorRows={(errorRows ?? []).map((r) => ({
          rowNumber: r.row_number as number,
          status: String(r.status),
          reason: String(r.error_message ?? ""),
        }))}
      />
    </div>
  );
}
