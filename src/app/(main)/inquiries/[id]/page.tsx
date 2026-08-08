import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInquiryById } from "@/lib/inquiries/read-list";
import { findCustomerCandidates } from "@/lib/inquiries/candidates";
import {
  INQUIRY_STATUS_LABELS,
  type InquiryStatus,
} from "@/lib/inquiries/types";
import { InquiryActionsPanel } from "@/features/inquiries/inquiry-actions-panel";
import { InquiryReplyDraftPanel } from "@/features/inquiries/inquiry-reply-draft-panel";
import { isDraftIntegrationConfigured } from "@/lib/inquiries/apps-script-draft-client";
import { formatDateTime } from "@/features/customers/format";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InquiryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "inquiry.view");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const inquiry = await getInquiryById(id);
  if (!inquiry) notFound();

  const canEdit = hasPermission(user.role, "inquiry.edit");
  const candidates = await findCustomerCandidates({
    email: inquiry.sender_email || inquiry.reply_to_email,
    phone: inquiry.phone,
    companyName: inquiry.company_name,
  });

  const admin = createAdminClient();
  const { data: users } = await admin
    .from("app_users")
    .select("id,display_name")
    .eq("is_active", true)
    .order("display_name");

  const basicFormKeys = new Set([
    "フリガナ",
    "部署名",
    "お問い合わせ種別",
    "フォーム",
  ]);
  const formEntries = Object.entries(inquiry.form_fields ?? {}).filter(
    ([k, v]) =>
      !basicFormKeys.has(k) && v != null && String(v).trim() !== "",
  );

  return (
    <div className="space-y-3">
      <Breadcrumbs
        items={[
          { label: "お問い合わせ", href: "/inquiries" },
          { label: inquiry.subject || inquiry.sender_name || "詳細" },
        ]}
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-base font-bold">
            {inquiry.subject || "（件名なし）"}
          </h1>
          <p className="text-xs text-slate-500">
            {formatDateTime(inquiry.received_at)} ·{" "}
            {INQUIRY_STATUS_LABELS[inquiry.status as InquiryStatus]}
            {inquiry.historical_import ? " · 過去取込" : ""}
          </p>
        </div>
        <Link
          href="/inquiries"
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          一覧へ戻る
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <section className="rounded border border-slate-200 bg-white p-3 text-xs">
            <h2 className="mb-2 font-semibold text-slate-800">基本情報</h2>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
              <dt className="text-slate-500">名前</dt>
              <dd>{inquiry.sender_name || "—"}</dd>
              <dt className="text-slate-500">フリガナ</dt>
              <dd>
                {String(
                  (inquiry.form_fields as Record<string, unknown>)?.["フリガナ"] ??
                    "",
                ).trim() || "—"}
              </dd>
              <dt className="text-slate-500">会社</dt>
              <dd>{inquiry.company_name || "—"}</dd>
              <dt className="text-slate-500">部署</dt>
              <dd>
                {String(
                  (inquiry.form_fields as Record<string, unknown>)?.["部署名"] ??
                    "",
                ).trim() || "—"}
              </dd>
              <dt className="text-slate-500">メール</dt>
              <dd>{inquiry.sender_email || "—"}</dd>
              <dt className="text-slate-500">Reply-To</dt>
              <dd>{inquiry.reply_to_email || "—"}</dd>
              <dt className="text-slate-500">電話</dt>
              <dd>{inquiry.phone || "—"}</dd>
              <dt className="text-slate-500">お問い合わせ種別</dt>
              <dd>
                {String(
                  (inquiry.form_fields as Record<string, unknown>)?.[
                    "お問い合わせ種別"
                  ] ?? inquiry.form_name ??
                    "",
                ).trim() || "—"}
              </dd>
              <dt className="text-slate-500">フォーム</dt>
              <dd>
                {String(
                  (inquiry.form_fields as Record<string, unknown>)?.["フォーム"] ??
                    "",
                ).trim() || "—"}
              </dd>
              <dt className="text-slate-500">source</dt>
              <dd>{inquiry.source}</dd>
            </dl>
            {inquiry.parse_status !== "ok" && (
              <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                解析注意: {inquiry.parse_warning_code || inquiry.parse_status}
              </p>
            )}
          </section>

          <section className="rounded border border-slate-200 bg-white p-3 text-xs">
            <h2 className="mb-2 font-semibold text-slate-800">問い合わせ本文</h2>
            <pre className="whitespace-pre-wrap break-words font-sans text-slate-800">
              {inquiry.message_text || "（本文なし）"}
            </pre>
          </section>

          {formEntries.length > 0 && (
            <section className="rounded border border-slate-200 bg-white p-3 text-xs">
              <h2 className="mb-2 font-semibold text-slate-800">
                追加フィールド
              </h2>
              <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
                {formEntries.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="whitespace-pre-wrap">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {Array.isArray(inquiry.attachment_meta) &&
            inquiry.attachment_meta.length > 0 && (
              <section className="rounded border border-slate-200 bg-white p-3 text-xs">
                <h2 className="mb-2 font-semibold text-slate-800">添付メタ</h2>
                <ul className="list-inside list-disc text-slate-700">
                  {inquiry.attachment_meta.map((a, i) => (
                    <li key={i}>
                      {String(a.filename ?? "（無名）")}
                      {a.mimeType ? ` · ${String(a.mimeType)}` : ""}
                      {a.size != null ? ` · ${String(a.size)} bytes` : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-slate-500">
                  添付ファイルの自動取込は行いません。
                </p>
              </section>
            )}
        </div>

        <div className="space-y-3 lg:col-span-2">
          <InquiryReplyDraftPanel
            inquiryId={inquiry.id}
            canEdit={canEdit}
            draftConfigured={isDraftIntegrationConfigured()}
          />
          <InquiryActionsPanel
            inquiryId={inquiry.id}
            status={inquiry.status as InquiryStatus}
            assignedUserId={inquiry.assigned_user_id}
            linkedCustomerPageId={inquiry.linked_customer_page_id}
            linkedContactPageId={inquiry.linked_contact_page_id}
            linkedActivityPageId={inquiry.linked_activity_page_id}
            canEdit={canEdit}
            currentUserId={user.id}
            assignees={(users ?? []).map((u) => ({
              id: u.id,
              label: u.display_name,
            }))}
            candidates={candidates}
          />
        </div>
      </div>
    </div>
  );
}
