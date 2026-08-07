import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { listContactsByCustomer } from "@/lib/contacts/read-list";
import { getCustomerDetail } from "@/lib/customers/read-detail";
import type { CustomerDetail } from "@/lib/customers/types";
import { listDealsByCustomer } from "@/lib/deals/read-list";
import { listActivitiesByCustomer } from "@/lib/activities/read-list";
import { listActions } from "@/lib/actions/read-list";
import { isCustomerSyncError } from "@/lib/sync/errors";
import {
  loadDetailLabelMaps,
  type DetailLabelMaps,
} from "@/features/customers/list-data";
import { loadListLabelMaps } from "@/features/contacts/list-data";
import { formatOptional } from "@/features/contacts/format";
import { formatDateTime, formatYen } from "@/features/customers/format";
import { CustomerDealsSection } from "@/features/deals/customer-deals-section";
import { loadListLabelMaps as loadDealListLabelMaps } from "@/features/deals/list-data";
import { CustomerActivitiesSection } from "@/features/activities/customer-activities-section";
import { loadListLabelMaps as loadActivityListLabelMaps } from "@/features/activities/list-data";
import { loadListLabelMaps as loadActionListLabelMaps } from "@/features/actions/list-data";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1">
      <dt className="w-28 shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="text-xs text-slate-900">{value ?? "-"}</dd>
    </div>
  );
}

function masterLabel(
  labels: DetailLabelMaps,
  id: string | null,
): React.ReactNode {
  if (!id) return "-";
  const name = labels.masterNames.get(id) ?? "(不明)";
  if (labels.inactiveMasterIds.has(id)) {
    return (
      <span>
        {name}
        <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">
          無効
        </span>
      </span>
    );
  }
  return name;
}

function masterLabels(labels: DetailLabelMaps, ids: string[]): React.ReactNode {
  if (ids.length === 0) return "-";
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {ids.map((id) => (
        <span key={id}>{masterLabel(labels, id)}</span>
      ))}
    </span>
  );
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawParams>;
}) {
  let canEdit = false;
  let canEditContact = false;
  let canEditDeal = false;
  let canEditActivity = false;
  let canEditAction = false;
  try {
    const user = await requireUser();
    canEdit = hasPermission(user.role, "customer.edit");
    canEditContact = hasPermission(user.role, "contact.edit");
    canEditDeal = hasPermission(user.role, "deal.edit");
    canEditActivity = hasPermission(user.role, "activity.edit");
    canEditAction = hasPermission(user.role, "action.edit");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  const rawSearch = await searchParams;
  const includeInactiveContacts = str(rawSearch, "contacts_inactive") === "1";
  if (!PAGE_ID_RE.test(id)) notFound();

  let detail: CustomerDetail;
  try {
    detail = await getCustomerDetail({ notionPageId: id });
  } catch (error) {
    if (isCustomerSyncError(error)) {
      if (error.code === "not_found") notFound();
      if (error.code === "in_trash") {
        return (
          <div className="mx-auto max-w-md py-16 text-center text-sm text-slate-600">
            この顧客はNotionのゴミ箱にあります。
            <div className="mt-3">
              <Link href="/customers" className="text-xs text-primary underline">
                一覧へ戻る
              </Link>
            </div>
          </div>
        );
      }
      // Notion障害時: customer_indexで代替表示しない
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
              href={`/customers/${id}`}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 hover:bg-slate-50"
            >
              再試行
            </a>
            <Link href="/customers" className="text-slate-500 hover:text-slate-900">
              一覧へ戻る
            </Link>
          </div>
        </div>
      );
    }
    throw error;
  }

  const labels = await loadDetailLabelMaps(detail);
  const [contacts, deals, activities, openActionsResult] = await Promise.all([
    listContactsByCustomer(detail.notionPageId, {
      includeInactive: includeInactiveContacts,
    }),
    listDealsByCustomer(detail.notionPageId),
    listActivitiesByCustomer(detail.notionPageId),
    listActions({
      customerPageId: detail.notionPageId,
      isOpen: true,
      sort: "due_date",
      sortDir: "asc",
      limit: 50,
    }),
  ]);
  const openActions = openActionsResult.rows;
  const [contactLabels, dealLabels, activityLabels, actionLabels] =
    await Promise.all([
      loadListLabelMaps(contacts),
      loadDealListLabelMaps(deals),
      loadActivityListLabelMaps(activities),
      loadActionListLabelMaps(openActions),
    ]);

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">{detail.displayName}</h1>
        <span className="text-xs">
          {masterLabel(labels, detail.salesStatusPageId)}
        </span>
        {detail.isArchived && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">
            アーカイブ
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs">
          {canEditActivity && !detail.isArchived && (
            <Link
              href={`/customers/${detail.notionPageId}/activities/new`}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
            >
              履歴追加
            </Link>
          )}
          {canEdit && (
            <Link
              href={`/customers/${detail.notionPageId}/edit`}
              className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover"
            >
              編集
            </Link>
          )}
          <Link
            href="/customers"
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
            <Item label="表示名" value={detail.displayName} />
            <Item label="法人名" value={detail.legalName} />
            <Item label="事業所名" value={detail.officeName} />
            <Item label="代表者名" value={detail.representativeName} />
            <Item
              label="Webサイト"
              value={
                detail.website ? (
                  <a
                    href={detail.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary underline"
                  >
                    {detail.website}
                  </a>
                ) : (
                  "-"
                )
              }
            />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">所在地</h2>
          <dl className="divide-y divide-slate-100">
            <Item label="郵便番号" value={detail.postalCode} />
            <Item label="都道府県" value={detail.prefecture} />
            <Item label="市区町村" value={detail.city} />
            <Item label="住所以降" value={detail.addressLine} />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">連絡先</h2>
          <dl className="divide-y divide-slate-100">
            <Item label="電話番号" value={detail.phone} />
            <Item label="メールアドレス" value={detail.email} />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">営業情報</h2>
          <dl className="divide-y divide-slate-100">
            <Item
              label="営業ステータス"
              value={masterLabel(labels, detail.salesStatusPageId)}
            />
            <Item
              label="集客ルート"
              value={masterLabel(labels, detail.acquisitionRoutePageId)}
            />
            <Item
              label="優先度"
              value={masterLabel(labels, detail.priorityPageId)}
            />
            <Item
              label="事業区分"
              value={masterLabels(labels, detail.businessCategoryPageIds)}
            />
            <Item label="タグ" value={masterLabels(labels, detail.tagPageIds)} />
            <Item
              label="自社担当者"
              value={
                detail.staffPageIds.length === 0 ? (
                  "-"
                ) : (
                  <span className="flex flex-wrap gap-x-2">
                    {detail.staffPageIds.map((pid) => (
                      <span key={pid}>
                        {labels.staffNamesByPageId.get(pid) ?? "(不明)"}
                        {labels.inactiveStaffPageIds.has(pid) && (
                          <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">
                            無効
                          </span>
                        )}
                      </span>
                    ))}
                  </span>
                )
              }
            />
            <Item
              label="見込み金額"
              value={
                <span>
                  {formatYen(detail.expectedAmount)}
                  <span className="ml-2 text-[10px] text-slate-400">
                    進行中・保留案件から自動集計
                  </span>
                </span>
              }
            />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3 lg:col-span-2">
          <h2 className="mb-1 text-xs font-bold text-slate-700">関連アカウント</h2>
          {detail.relatedAccountPageIds.length === 0 ? (
            <p className="text-xs text-slate-400">関連アカウントはありません</p>
          ) : (
            <ul className="flex flex-wrap gap-2 text-xs">
              {detail.relatedAccountPageIds.map((pid) => {
                const rel = labels.relatedCustomers.get(pid);
                return (
                  <li key={pid}>
                    <Link
                      href={`/customers/${pid}`}
                      className="text-primary underline"
                    >
                      {rel?.displayName ?? "(不明)"}
                    </Link>
                    {rel?.isArchived && (
                      <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">
                        アーカイブ
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <h2 className="text-xs font-bold text-slate-700">先方担当者</h2>
          <span className="text-xs text-slate-500">{contacts.length}件</span>
          <label className="ml-2 flex items-center gap-1 text-xs text-slate-600">
            {includeInactiveContacts ? (
              <Link
                href={`/customers/${detail.notionPageId}`}
                className="text-primary underline"
              >
                有効のみ表示
              </Link>
            ) : (
              <Link
                href={`/customers/${detail.notionPageId}?contacts_inactive=1`}
                className="text-primary underline"
              >
                無効も含める
              </Link>
            )}
          </label>
          {canEditContact && !detail.isArchived && (
            <Link
              href={`/customers/${detail.notionPageId}/contacts/new`}
              className="ml-auto rounded bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover"
            >
              担当者を追加
            </Link>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
                <th className="px-2 py-1.5 font-medium">氏名</th>
                <th className="px-2 py-1.5 font-medium">部署</th>
                <th className="px-2 py-1.5 font-medium">役職</th>
                <th className="px-2 py-1.5 font-medium">電話番号</th>
                <th className="px-2 py-1.5 font-medium">メール</th>
                <th className="px-2 py-1.5 font-medium">担当者区分</th>
                <th className="px-2 py-1.5 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    {includeInactiveContacts
                      ? "担当者は登録されていません。"
                      : "有効な担当者はいません。"}
                    {canEditContact && !detail.isArchived && (
                      <span className="ml-2">
                        <Link
                          href={`/customers/${detail.notionPageId}/contacts/new`}
                          className="text-primary underline"
                        >
                          担当者を追加
                        </Link>
                      </span>
                    )}
                  </td>
                </tr>
              )}
              {contacts.map((row) => (
                <tr
                  key={row.notion_page_id}
                  className="border-b border-slate-100 hover:bg-slate-50"
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
                    {formatOptional(row.department)}
                  </td>
                  <td className="max-w-28 truncate px-2 py-1.5">
                    {formatOptional(row.title)}
                  </td>
                  <td className="px-2 py-1.5">
                    {row.phone ? (
                      <a
                        href={`tel:${row.phone}`}
                        className="text-primary underline"
                      >
                        {row.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="max-w-48 truncate px-2 py-1.5">
                    {row.email ? (
                      <a
                        href={`mailto:${row.email}`}
                        className="text-primary underline"
                      >
                        {row.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {row.contact_type_id
                      ? (contactLabels.contactTypeNames.get(
                          row.contact_type_id,
                        ) ?? "—")
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CustomerDealsSection
        customerPageId={detail.notionPageId}
        deals={deals}
        labels={dealLabels}
        canEditDeal={canEditDeal}
        customerArchived={detail.isArchived}
        expectedAmount={detail.expectedAmount}
      />

      <CustomerActivitiesSection
        customerPageId={detail.notionPageId}
        activities={activities}
        activityLabels={activityLabels}
        openActions={openActions}
        actionLabels={actionLabels}
        canEditActivity={canEditActivity}
        canEditAction={canEditAction}
        customerArchived={detail.isArchived}
        derived={{
          latestActivitySummary: detail.latestActivitySummary,
          lastActivityAt: detail.lastActivityAt,
          nextAction: detail.nextAction,
          nextActionDate: detail.nextActionDate,
        }}
      />

      <p className="text-xs text-slate-400">
        作成日時: {formatDateTime(detail.createdTime)} / 更新日時:{" "}
        {formatDateTime(detail.lastEditedTime)}
      </p>
    </div>
  );
}
