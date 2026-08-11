import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { listInquiries } from "@/lib/inquiries/read-list";
import type { InquiryStatus } from "@/lib/inquiries/types";
import { InquiryToolbar } from "@/features/inquiries/inquiry-toolbar";
import { InquiryListControls } from "@/features/inquiries/inquiry-list-controls";
import { CompactEmptyState } from "@/components/ui/compact-empty-state";
import { formatDateTime } from "@/features/customers/format";
import { PageHeading } from "@/components/ui/page-heading";

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
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "inquiry.view");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const canEdit = hasPermission(user.role, "inquiry.edit");
  const raw = await searchParams;
  const tabParam = str(raw, "tab");
  const statusParam = str(raw, "status");
  const queryParam = str(raw, "q");
  const assignedParam = str(raw, "assigned");
  const receivedFromParam = str(raw, "from");
  const receivedToParam = str(raw, "to");
  const hasActiveFilters = Boolean(
    queryParam ||
      assignedParam ||
      statusParam ||
      receivedFromParam ||
      receivedToParam ||
      (tabParam && tabParam !== "open"),
  );
  const { rows, total } = await listInquiries({
    tab: tabParam || statusParam || "open",
    q: queryParam,
    assignedUserId: assignedParam,
    status: tabParam ? statusParam : undefined,
    receivedFrom: receivedFromParam,
    receivedTo: receivedToParam,
  });

  const admin = createAdminClient();
  const { data: users } = await admin
    .from("app_users")
    .select("id,display_name,is_active")
    .order("display_name");
  const activeAssignees = (users ?? []).filter((u) => u.is_active).map((u) => ({
    id: u.id,
    label: u.display_name,
  }));
  const assigneesForCurrent = (assignedUserId: string | null) => {
    const inactive = (users ?? []).find(
      (candidate) => candidate.id === assignedUserId && !candidate.is_active,
    );
    return inactive
      ? [
          ...activeAssignees,
          {
            id: inactive.id,
            label: `${inactive.display_name}（利用停止）`,
            disabled: true,
          },
        ]
      : activeAssignees;
  };

  return (
    <div className="space-y-3">
      <PageHeading
        title="お問い合わせ"
        description="Webフォームから届いた問い合わせを、社内対応担当と状態で管理します。"
        meta={`${total}件`}
      />
      <Suspense fallback={null}>
        <InquiryToolbar assignees={activeAssignees} />
      </Suspense>
      {rows.length === 0 ? (
        <CompactEmptyState
          message={
            hasActiveFilters
              ? "条件に一致するお問い合わせはありません。"
              : "現在、対応が必要なお問い合わせはありません。"
          }
          actionHref={hasActiveFilters ? "/inquiries" : undefined}
          actionLabel={hasActiveFilters ? "条件をリセット" : undefined}
        />
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
                <th className="px-2 py-1.5 font-medium">社内対応担当</th>
                <th className="px-2 py-1.5 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-slate-100 hover:bg-slate-50"
                >
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
                  <InquiryListControls
                    inquiryId={r.id}
                    assignedUserId={r.assigned_user_id}
                    status={r.status as InquiryStatus}
                    canEdit={canEdit}
                    assignees={assigneesForCurrent(r.assigned_user_id)}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
