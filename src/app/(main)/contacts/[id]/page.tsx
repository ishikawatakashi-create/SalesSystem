import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getContactDetail } from "@/lib/contacts/read-detail";
import type { ContactDetail } from "@/lib/contacts/types";
import { listActivities } from "@/lib/activities/read-list";
import { listActions } from "@/lib/actions/read-list";
import { isContactSyncError } from "@/lib/sync/errors";
import { loadDetailLabelMaps } from "@/features/contacts/list-data";
import {
  formatDateTime,
  formatOptional,
} from "@/features/contacts/format";
import { ContactRelatedSection } from "@/features/activities/contact-related-section";
import { loadListLabelMaps as loadActivityListLabelMaps } from "@/features/activities/list-data";
import { loadListLabelMaps as loadActionListLabelMaps } from "@/features/actions/list-data";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1">
      <dt className="w-28 shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="text-xs text-slate-900">{value ?? "—"}</dd>
    </div>
  );
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let canEdit = false;
  let canEditActivity = false;
  let canEditAction = false;
  try {
    const user = await requireUser();
    canEdit = hasPermission(user.role, "contact.edit");
    canEditActivity = hasPermission(user.role, "activity.edit");
    canEditAction = hasPermission(user.role, "action.edit");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  if (!PAGE_ID_RE.test(id)) notFound();

  let detail: ContactDetail;
  try {
    detail = await getContactDetail({ notionPageId: id });
  } catch (error) {
    if (isContactSyncError(error)) {
      if (error.code === "not_found") notFound();
      if (error.code === "in_trash") {
        return (
          <div className="mx-auto max-w-md py-16 text-center text-sm text-slate-600">
            この担当者はNotionのゴミ箱にあります。
            <div className="mt-3">
              <Link href="/contacts" className="text-xs text-primary underline">
                一覧へ戻る
              </Link>
            </div>
          </div>
        );
      }
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <p className="text-sm font-medium text-slate-900">
            Notionへの接続に失敗しました
          </p>
          <p className="mt-1 text-xs text-slate-500">
            正本データを取得できないため、この画面ではキャッシュを表示しません。
            通信状態を確認のうえ再試行してください。
          </p>
          <div className="mt-4 flex items-center justify-center gap-3 text-xs">
            <a
              href={`/contacts/${id}`}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 hover:bg-slate-50"
            >
              再試行
            </a>
            <Link href="/contacts" className="text-slate-500 hover:text-slate-900">
              一覧へ戻る
            </Link>
          </div>
        </div>
      );
    }
    throw error;
  }

  const labels = await loadDetailLabelMaps(detail);
  const [activitiesResult, openActionsResult] = await Promise.all([
    listActivities({
      contactPageId: detail.notionPageId,
      sort: "activity_at",
      sortDir: "desc",
      limit: 50,
    }),
    detail.customerPageId
      ? listActions({
          customerPageId: detail.customerPageId,
          isOpen: true,
          sort: "due_date",
          sortDir: "asc",
          limit: 50,
        })
      : Promise.resolve({ rows: [], count: 0 }),
  ]);
  const [activityLabels, actionLabels] = await Promise.all([
    loadActivityListLabelMaps(activitiesResult.rows),
    loadActionListLabelMaps(openActionsResult.rows),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">{detail.name}</h1>
        {!detail.isActive && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">
            無効
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs">
          {canEditActivity && detail.customerPageId && (
            <Link
              href={`/contacts/${detail.notionPageId}/activities/new`}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
            >
              履歴追加
            </Link>
          )}
          {canEdit && (
            <Link
              href={`/contacts/${detail.notionPageId}/edit`}
              className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover"
            >
              編集
            </Link>
          )}
          <Link
            href="/contacts"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
          >
            一覧へ戻る
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">基本情報</h2>
          <dl className="divide-y divide-slate-100">
            <Item label="氏名" value={detail.name} />
            <Item label="氏名よみ" value={formatOptional(detail.nameKana)} />
            <Item
              label="所属顧客"
              value={
                detail.customerPageId ? (
                  <span>
                    <Link
                      href={`/customers/${detail.customerPageId}`}
                      className="text-primary underline"
                    >
                      {labels.customerName ?? "(不明)"}
                    </Link>
                    {labels.customerArchived && (
                      <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">
                        アーカイブ
                      </span>
                    )}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Item label="部署" value={formatOptional(detail.department)} />
            <Item label="役職" value={formatOptional(detail.title)} />
            <Item
              label="担当者区分"
              value={
                detail.contactTypePageId ? (
                  <span>
                    {labels.contactTypeName ?? "(不明)"}
                    {labels.contactTypeInactive && (
                      <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">
                        無効
                      </span>
                    )}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Item
              label="有効"
              value={detail.isActive ? "有効" : "無効"}
            />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">連絡先</h2>
          <dl className="divide-y divide-slate-100">
            <Item
              label="電話番号"
              value={
                detail.phone ? (
                  <a href={`tel:${detail.phone}`} className="text-primary underline">
                    {detail.phone}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Item
              label="メールアドレス"
              value={
                detail.email ? (
                  <a
                    href={`mailto:${detail.email}`}
                    className="text-primary underline"
                  >
                    {detail.email}
                  </a>
                ) : (
                  "—"
                )
              }
            />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3 lg:col-span-2">
          <h2 className="mb-1 text-xs font-bold text-slate-700">備考</h2>
          <p className="whitespace-pre-wrap text-xs text-slate-900">
            {detail.note?.trim() ? detail.note : "—"}
          </p>
        </section>
      </div>

      <ContactRelatedSection
        contactPageId={detail.notionPageId}
        customerPageId={detail.customerPageId}
        activities={activitiesResult.rows}
        activityLabels={activityLabels}
        openActions={openActionsResult.rows}
        actionLabels={actionLabels}
        canEditActivity={canEditActivity}
        canEditAction={canEditAction}
      />

      <p className="text-xs text-slate-400">
        作成日時: {formatDateTime(detail.createdTime)} / 更新日時:{" "}
        {formatDateTime(detail.lastEditedTime)}
      </p>
    </div>
  );
}
