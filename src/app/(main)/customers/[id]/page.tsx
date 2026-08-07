import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { CompactEmptyState } from "@/components/ui/compact-empty-state";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { listContactsByCustomer } from "@/lib/contacts/read-list";
import { getCustomerDetail } from "@/lib/customers/read-detail";
import type { CustomerDetail } from "@/lib/customers/types";
import { touchRecentView } from "@/lib/mydesk/recent-views";
import { listDealsByCustomer } from "@/lib/deals/read-list";
import { listActivitiesByCustomer } from "@/lib/activities/read-list";
import { listActions } from "@/lib/actions/read-list";
import { listActiveContractsByCustomer } from "@/lib/contracts/read-list";
import { listUnresolvedComplaintsByCustomer } from "@/lib/complaints/read-list";
import { listMasters } from "@/lib/masters/read";
import { isCustomerSyncError } from "@/lib/sync/errors";
import {
  loadDetailLabelMaps,
  type DetailLabelMaps,
} from "@/features/customers/list-data";
import { loadListLabelMaps } from "@/features/contacts/list-data";
import { formatOptional } from "@/features/contacts/format";
import { formatDate, formatDateTime, formatYen } from "@/features/customers/format";
import { CustomerDealsSection } from "@/features/deals/customer-deals-section";
import { loadListLabelMaps as loadDealListLabelMaps } from "@/features/deals/list-data";
import { CustomerActivitiesSection } from "@/features/activities/customer-activities-section";
import { QuickActivityComposer } from "@/features/activities/quick-activity-composer";
import { loadListLabelMaps as loadActivityListLabelMaps } from "@/features/activities/list-data";
import { loadListLabelMaps as loadActionListLabelMaps } from "@/features/actions/list-data";
import { CustomerContractsSection } from "@/features/contracts/customer-contracts-section";
import { loadListLabelMaps as loadContractListLabelMaps } from "@/features/contracts/list-data";
import { CustomerComplaintsSection } from "@/features/complaints/customer-complaints-section";
import { loadListLabelMaps as loadComplaintListLabelMaps } from "@/features/complaints/list-data";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

function masterLabel(
  labels: DetailLabelMaps,
  id: string | null,
): React.ReactNode {
  if (!id) return null;
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

function masterLabels(
  labels: DetailLabelMaps,
  ids: string[],
): React.ReactNode | null {
  if (ids.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {ids.map((id) => (
        <span key={id}>{masterLabel(labels, id) ?? "(不明)"}</span>
      ))}
    </span>
  );
}

function staffLabels(labels: DetailLabelMaps, ids: string[]): React.ReactNode | null {
  if (ids.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-2">
      {ids.map((pid) => (
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
  );
}

function OverviewItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex gap-2 py-0.5">
      <dt className="w-28 shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="text-xs text-slate-900">{value}</dd>
    </div>
  );
}

type OverviewField = { label: string; value: React.ReactNode | null };

function isPresent(value: React.ReactNode | null | undefined): boolean {
  if (value == null) return false;
  if (typeof value === "string") {
    const t = value.trim();
    return t !== "" && t !== "-" && t !== "—";
  }
  return true;
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
  let canEditContract = false;
  let canEditComplaint = false;
  let viewerUserId: string | null = null;
  try {
    const user = await requireUser();
    viewerUserId = user.id;
    canEdit = hasPermission(user.role, "customer.edit");
    canEditContact = hasPermission(user.role, "contact.edit");
    canEditDeal = hasPermission(user.role, "deal.edit");
    canEditActivity = hasPermission(user.role, "activity.edit");
    canEditAction = hasPermission(user.role, "action.edit");
    canEditContract = hasPermission(user.role, "contract.edit");
    canEditComplaint = hasPermission(user.role, "complaint.edit");
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
    if (viewerUserId) {
      await touchRecentView(viewerUserId, id);
    }
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
  const [
    contacts,
    deals,
    activities,
    openActionsResult,
    activeContracts,
    unresolvedComplaints,
    activityCategories,
  ] = await Promise.all([
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
    listActiveContractsByCustomer(detail.notionPageId),
    listUnresolvedComplaintsByCustomer(detail.notionPageId),
    listMasters({ types: ["対応履歴分類"] }).catch(() => []),
  ]);
  const openActions = openActionsResult.rows;
  const [
    contactLabels,
    dealLabels,
    activityLabels,
    actionLabels,
    contractLabels,
    complaintLabels,
  ] = await Promise.all([
    loadListLabelMaps(contacts),
    loadDealListLabelMaps(deals),
    loadActivityListLabelMaps(activities),
    loadActionListLabelMaps(openActions),
    loadContractListLabelMaps(activeContracts),
    loadComplaintListLabelMaps(unresolvedComplaints),
  ]);

  const activeContacts = contacts.filter((c) => c.is_active);
  const dealOptions = deals.map((d) => ({
    id: d.notion_page_id,
    label: d.title || "(無題)",
  }));
  const contactOptions = activeContacts.map((c) => ({
    id: c.notion_page_id,
    label: c.name || "(無題)",
  }));
  const categoryOptions = activityCategories.map((m) => ({
    id: m.notion_page_id,
    label: m.name,
  }));

  const staffSummary = staffLabels(labels, detail.staffPageIds);
  const salesStatus = masterLabel(labels, detail.salesStatusPageId);
  const priority = masterLabel(labels, detail.priorityPageId);
  const nextActionDateLabel = formatDate(detail.nextActionDate);

  const overviewFields: OverviewField[] = [
    { label: "表示名", value: detail.displayName || null },
    { label: "法人名", value: detail.legalName },
    { label: "事業所名", value: detail.officeName },
    { label: "代表者名", value: detail.representativeName },
    {
      label: "Webサイト",
      value: detail.website ? (
        <a
          href={detail.website}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline"
        >
          {detail.website}
        </a>
      ) : null,
    },
    { label: "郵便番号", value: detail.postalCode },
    { label: "都道府県", value: detail.prefecture },
    { label: "市区町村", value: detail.city },
    { label: "住所以降", value: detail.addressLine },
    { label: "電話番号", value: detail.phone },
    { label: "メールアドレス", value: detail.email },
    {
      label: "営業ステータス",
      value: salesStatus,
    },
    {
      label: "集客ルート",
      value: masterLabel(labels, detail.acquisitionRoutePageId),
    },
    { label: "優先度", value: priority },
    {
      label: "事業区分",
      value: masterLabels(labels, detail.businessCategoryPageIds),
    },
    { label: "タグ", value: masterLabels(labels, detail.tagPageIds) },
    { label: "自社担当者", value: staffSummary },
    {
      label: "見込み金額",
      value:
        detail.expectedAmount != null ? (
          <span>
            {formatYen(detail.expectedAmount)}
            <span className="ml-2 text-[10px] text-slate-400">
              進行中・保留案件から自動集計
            </span>
          </span>
        ) : null,
    },
    {
      label: "関連アカウント",
      value:
        detail.relatedAccountPageIds.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
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
        ) : null,
    },
  ];
  const filledOverview = overviewFields.filter((f) => isPresent(f.value));
  const emptyOverview = overviewFields.filter((f) => !isPresent(f.value));

  const contactsQueryBase = `/customers/${detail.notionPageId}`;

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <Breadcrumbs
        items={[
          { label: "顧客一覧", href: "/customers" },
          { label: detail.displayName || "(無題)" },
        ]}
      />

      {/* 1. Summary strip */}
      <section className="rounded border border-slate-200 bg-white px-3 py-2">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-bold leading-tight">
                {detail.displayName || "(無題)"}
              </h1>
              {detail.isArchived && (
                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
                  アーカイブ
                </span>
              )}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
              {salesStatus && <span>ステータス: {salesStatus}</span>}
              {priority && <span>優先度: {priority}</span>}
              {staffSummary && <span>担当: {staffSummary}</span>}
              <span>見込み: {formatYen(detail.expectedAmount)}</span>
              {nextActionDateLabel !== "-" && (
                <span>次回予定: {nextActionDateLabel}</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {canEdit && (
              <Link
                href={`/customers/${detail.notionPageId}/edit`}
                className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover"
              >
                編集
              </Link>
            )}
            {canEditAction && !detail.isArchived && (
              <Link
                href={`/customers/${detail.notionPageId}/actions/new`}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
              >
                アクション追加
              </Link>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
          {canEditContact && !detail.isArchived && (
            <Link
              href={`/customers/${detail.notionPageId}/contacts/new`}
              className="underline-offset-2 hover:underline"
            >
              担当者追加
            </Link>
          )}
          {canEditDeal && !detail.isArchived && (
            <Link
              href={`/customers/${detail.notionPageId}/deals/new`}
              className="underline-offset-2 hover:underline"
            >
              案件追加
            </Link>
          )}
          {canEditContract && !detail.isArchived && (
            <Link
              href={`/customers/${detail.notionPageId}/contracts/new`}
              className="underline-offset-2 hover:underline"
            >
              契約追加
            </Link>
          )}
          {canEditComplaint && !detail.isArchived && (
            <Link
              href={`/customers/${detail.notionPageId}/complaints/new`}
              className="underline-offset-2 hover:underline"
            >
              クレーム登録
            </Link>
          )}
          <Link
            href="/customers"
            className="underline-offset-2 hover:underline"
          >
            一覧へ戻る
          </Link>
        </div>
      </section>

      {/* 2. 活動 — always visible */}
      <section className="space-y-2">
        <h2 className="text-xs font-bold text-slate-700">活動</h2>
        {canEditActivity && !detail.isArchived && (
          <QuickActivityComposer
            customerPageId={detail.notionPageId}
            dealOptions={dealOptions}
            contactOptions={contactOptions}
            categoryOptions={categoryOptions}
            detailNewHref={`/customers/${detail.notionPageId}/activities/new`}
          />
        )}
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
      </section>

      {/* 3. 概要 — 入力済みのみ常時表示 */}
      <section className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-3 py-2">
          <h2 className="text-xs font-bold text-slate-700">
            概要
            <span className="ml-2 font-normal text-slate-400">
              {filledOverview.length}項目
            </span>
          </h2>
        </div>
        <div className="px-3 py-2">
          {filledOverview.length === 0 ? (
            <p className="text-xs text-slate-500">入力済みの項目はありません。</p>
          ) : (
            <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {filledOverview.map((f) => (
                <OverviewItem key={f.label} label={f.label} value={f.value} />
              ))}
            </dl>
          )}
          {emptyOverview.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700">
                未入力項目を表示 ({emptyOverview.length})
              </summary>
              <dl className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                {emptyOverview.map((f) => (
                  <OverviewItem key={f.label} label={f.label} value="—" />
                ))}
              </dl>
            </details>
          )}
        </div>
      </section>

      {/* 4. 案件・担当者 */}
      <section className="space-y-2">
        <h2 className="text-xs font-bold text-slate-700">案件・担当者</h2>
        <section className="rounded border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-2.5 py-1.5">
            <h3 className="text-xs font-bold text-slate-700">先方担当者</h3>
            <span className="text-xs text-slate-500">{contacts.length}件</span>
            {includeInactiveContacts ? (
              <Link
                href={contactsQueryBase}
                className="text-[11px] text-slate-600 underline-offset-2 hover:underline"
              >
                有効のみ表示
              </Link>
            ) : (
              <Link
                href={`${contactsQueryBase}?contacts_inactive=1`}
                className="text-[11px] text-slate-600 underline-offset-2 hover:underline"
              >
                無効も含める
              </Link>
            )}
            {canEditContact && !detail.isArchived && contacts.length > 0 && (
              <Link
                href={`/customers/${detail.notionPageId}/contacts/new`}
                className="ml-auto text-xs text-slate-600 underline-offset-2 hover:underline"
              >
                追加
              </Link>
            )}
          </div>
          {contacts.length === 0 ? (
            <div className="px-2.5 py-1.5">
              <CompactEmptyState
                message={
                  includeInactiveContacts
                    ? "担当者は登録されていません。"
                    : "有効な担当者はいません。"
                }
                actionHref={
                  canEditContact && !detail.isArchived
                    ? `/customers/${detail.notionPageId}/contacts/new`
                    : undefined
                }
                actionLabel={
                  canEditContact && !detail.isArchived
                    ? "担当者を追加"
                    : undefined
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
                    <th className="px-2 py-1 font-medium">氏名</th>
                    <th className="px-2 py-1 font-medium">部署</th>
                    <th className="px-2 py-1 font-medium">役職</th>
                    <th className="px-2 py-1 font-medium">電話番号</th>
                    <th className="px-2 py-1 font-medium">メール</th>
                    <th className="px-2 py-1 font-medium">担当者区分</th>
                    <th className="px-2 py-1 font-medium">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((row) => (
                    <tr
                      key={row.notion_page_id}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="max-w-40 truncate px-2 py-1 font-medium">
                        <Link
                          href={`/contacts/${row.notion_page_id}`}
                          className="text-primary hover:underline"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="max-w-32 truncate px-2 py-1">
                        {formatOptional(row.department)}
                      </td>
                      <td className="max-w-28 truncate px-2 py-1">
                        {formatOptional(row.title)}
                      </td>
                      <td className="px-2 py-1">
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
                      <td className="max-w-48 truncate px-2 py-1">
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
                      <td className="px-2 py-1">
                        {row.contact_type_id
                          ? (contactLabels.contactTypeNames.get(
                              row.contact_type_id,
                            ) ?? "—")
                          : "—"}
                      </td>
                      <td className="px-2 py-1">
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
          )}
        </section>

        <CustomerDealsSection
          customerPageId={detail.notionPageId}
          deals={deals}
          labels={dealLabels}
          canEditDeal={canEditDeal}
          customerArchived={detail.isArchived}
          expectedAmount={detail.expectedAmount}
        />
      </section>

      {/* 5. 契約・クレーム */}
      <section className="space-y-2">
        <h2 className="text-xs font-bold text-slate-700">契約・クレーム</h2>
        <CustomerContractsSection
          customerPageId={detail.notionPageId}
          contracts={activeContracts}
          labels={contractLabels}
          canEdit={canEditContract}
          customerArchived={detail.isArchived}
        />
        <CustomerComplaintsSection
          customerPageId={detail.notionPageId}
          complaints={unresolvedComplaints}
          labels={complaintLabels}
          canEdit={canEditComplaint}
          customerArchived={detail.isArchived}
        />
      </section>

      <p className="text-xs text-slate-400">
        作成日時: {formatDateTime(detail.createdTime)} / 更新日時:{" "}
        {formatDateTime(detail.lastEditedTime)}
      </p>
    </div>
  );
}
