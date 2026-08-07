import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import { listInquiries } from "@/lib/inquiries/read-list";
import {
  INQUIRY_STATUS_LABELS,
  type InquiryStatus,
} from "@/lib/inquiries/types";
import { InquiryToolbar } from "@/features/inquiries/inquiry-toolbar";
import { CompactEmptyState } from "@/components/ui/compact-empty-state";
import { formatDateTime } from "@/features/customers/format";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export default async function InquiriesPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  try {
    const user = await requireUser();
    requirePermission(user, "inquiry.view");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const raw = await searchParams;
  const tabParam = str(raw, "tab");
  const statusParam = str(raw, "status");
  // ?status=new はタブ相当。詳細条件の status 上書きは tab 併用時のみ
  const { rows, total } = await listInquiries({
    tab: tabParam || statusParam || "open",
    q: str(raw, "q"),
    assignedUserId: str(raw, "assigned"),
    status: tabParam ? statusParam : undefined,
    receivedFrom: str(raw, "from"),
    receivedTo: str(raw, "to"),
  });

  const admin = createAdminClient();
  const { data: users } = await admin
    .from("app_users")
    .select("id,display_name")
    .eq("is_active", true)
    .order("display_name");
  const nameById = new Map(
    (users ?? []).map((u) => [u.id, u.display_name] as const),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-base font-bold">お問い合わせ</h1>
        <span className="text-xs text-slate-500">{total}件</span>
      </div>
      <Suspense fallback={null}>
        <InquiryToolbar
          assignees={(users ?? []).map((u) => ({
            id: u.id,
            label: u.display_name,
          }))}
        />
      </Suspense>
      {rows.length === 0 ? (
        <CompactEmptyState message="該当するお問い合わせはありません。" />
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">受信日時</th>
                <th className="px-2 py-1.5 font-medium">名前</th>
                <th className="px-2 py-1.5 font-medium">会社</th>
                <th className="px-2 py-1.5 font-medium">メール</th>
                <th className="px-2 py-1.5 font-medium">概要</th>
                <th className="px-2 py-1.5 font-medium">担当</th>
                <th className="px-2 py-1.5 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <Link
                      href={`/inquiries/${r.id}`}
                      className="text-primary underline"
                    >
                      {formatDateTime(r.received_at)}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">{r.sender_name || "—"}</td>
                  <td className="px-2 py-1.5">{r.company_name || "—"}</td>
                  <td className="px-2 py-1.5">{r.sender_email || "—"}</td>
                  <td className="max-w-xs truncate px-2 py-1.5">
                    <span className="inline-flex items-center gap-1">
                      {r.historical_import ? (
                        <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500">
                          過去取込
                        </span>
                      ) : null}
                      <span className="truncate">
                        {r.subject || r.message_text?.slice(0, 40) || "—"}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    {r.assigned_user_id
                      ? nameById.get(r.assigned_user_id) || "—"
                      : "未割当"}
                  </td>
                  <td className="px-2 py-1.5">
                    {INQUIRY_STATUS_LABELS[r.status as InquiryStatus] ?? r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
