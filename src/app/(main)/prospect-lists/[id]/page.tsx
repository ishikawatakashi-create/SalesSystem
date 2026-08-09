import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchProspectListStats,
  getProspectList,
} from "@/lib/prospects/lists";
import { queryProspectListMembers } from "@/lib/prospects/read-list";
import {
  PROSPECT_MEMBERSHIP_STAGES,
  PROSPECT_STAGE_LABELS,
  type ProspectMembershipStage,
} from "@/lib/prospects/types";
import { MembershipControls } from "@/features/prospects/membership-controls";
import { BulkAssignPanel } from "@/features/prospects/bulk-assign-panel";
import { CompactEmptyState } from "@/components/ui/compact-empty-state";
import { FilterDisclosure } from "@/components/ui/filter-disclosure";
import { formatDateTime } from "@/features/customers/format";
import { fetchListCallKpis, formatRate } from "@/lib/prospects/kpi";
import { CALL_RESULT_LABELS, type CallResult } from "@/lib/prospects/call-results";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export default async function ProspectListDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawParams>;
}) {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "prospect.view");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  const raw = await searchParams;
  const list = await getProspectList(id);
  if (!list || list.archived_at) {
    redirect("/prospect-lists");
  }

  const canEdit = hasPermission(user.role, "prospect.edit");
  const canImport = hasPermission(user.role, "prospect.import");
  const canAssign = hasPermission(user.role, "prospect.assign");
  const canCall = hasPermission(user.role, "prospect.call");
  const kpiPeriod =
    (str(raw, "kpi") as "today" | "7d" | "30d" | "all" | undefined) ?? "30d";

  const stageParam = str(raw, "stage") as ProspectMembershipStage | undefined;
  const page = Math.max(Number(str(raw, "page") ?? "1") || 1, 1);
  const { items, total } = await queryProspectListMembers({
    listId: id,
    q: str(raw, "q"),
    stage:
      stageParam && PROSPECT_MEMBERSHIP_STAGES.includes(stageParam)
        ? stageParam
        : null,
    assignedUserId: str(raw, "assigned"),
    unassignedOnly: str(raw, "unassigned") === "1",
    prefecture: str(raw, "prefecture"),
    industry: str(raw, "industry"),
    dncOnly: str(raw, "dnc") === "1",
    duplicateReview: str(raw, "duplicate") === "1",
    formalMatchOnly: str(raw, "formalMatch") === "1",
    page,
    pageSize: 50,
  });

  const statsMap = await fetchProspectListStats([id]);
  const stats = statsMap.get(id);
  let callKpi = null as Awaited<ReturnType<typeof fetchListCallKpis>>[number] | null;
  try {
    const kpis = await fetchListCallKpis({ listIds: [id], period: kpiPeriod });
    callKpi = kpis[0] ?? null;
  } catch {
    callKpi = null;
  }

  const admin = createAdminClient();
  const { data: users } = await admin
    .from("app_users")
    .select("id,display_name,is_active")
    .order("display_name");
  const activeAssignees = (users ?? []).filter((u) => u.is_active).map((u) => ({
    id: String(u.id),
    label: String(u.display_name),
  }));
  const assigneesForCurrent = (assignedUserId: string | null) => {
    const inactive = (users ?? []).find(
      (candidate) => candidate.id === assignedUserId && !candidate.is_active,
    );
    return inactive
      ? [
          ...activeAssignees,
          {
            id: String(inactive.id),
            label: `${inactive.display_name}（利用停止）`,
            disabled: true,
          },
        ]
      : activeAssignees;
  };

  const advanced =
    [str(raw, "prefecture"), str(raw, "industry")].filter(Boolean).length +
    (str(raw, "dnc") === "1" ? 1 : 0) +
    (str(raw, "duplicate") === "1" ? 1 : 0) +
    (str(raw, "formalMatch") === "1" ? 1 : 0);

  const pageCount = Math.max(Math.ceil(total / 50), 1);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Link href="/prospect-lists" className="text-xs text-slate-500">
            ← 営業リスト
          </Link>
          <h1 className="text-base font-bold">{list.name}</h1>
          <p className="text-xs text-slate-500">
            {list.source_type}
            {list.source_name ? ` / ${list.source_name}` : ""} · {list.status}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCall ? (
            <Link
              href={`/call-queue?list=${id}`}
              className="rounded bg-slate-900 px-2 py-1 text-xs text-white"
            >
              架電キュー
            </Link>
          ) : null}
          {canImport ? (
            <Link
              href={`/prospect-lists/${id}/import`}
              className="rounded bg-slate-800 px-2 py-1 text-xs text-white"
            >
              CSVをインポート
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <Stat label="総件数" value={stats?.total_count ?? 0} />
        <Stat label="未割当" value={stats?.unassigned_count ?? 0} />
        <Stat label="割当済" value={stats?.assigned_count ?? 0} />
        <Stat label="対応中" value={stats?.working_count ?? 0} />
        <Stat label="見込あり" value={stats?.qualified_count ?? 0} />
        <Stat label="対象外" value={stats?.disqualified_count ?? 0} />
        <Stat label="DNC" value={stats?.dnc_count ?? 0} />
        <Stat label="重複候補" value={stats?.duplicate_review_count ?? 0} />
      </div>

      {callKpi ? (
        <div className="space-y-1 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-600">
            <span className="font-semibold text-slate-800">架電KPI</span>
            {(["today", "7d", "30d", "all"] as const).map((p) => (
              <Link
                key={p}
                href={`?kpi=${p}`}
                className={
                  kpiPeriod === p ? "font-semibold underline" : "underline"
                }
              >
                {p === "today"
                  ? "今日"
                  : p === "7d"
                    ? "7日"
                    : p === "30d"
                      ? "30日"
                      : "全期間"}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Stat label="架電数" value={callKpi.attemptCount} />
            <Stat label="接触(社数)" value={callKpi.connectedProspectCount} />
            <Stat label="興味あり" value={callKpi.interestedProspectCount} />
            <Stat label="アポ" value={callKpi.appointmentProspectCount} />
            <Stat label="対象外" value={callKpi.disqualifiedProspectCount} />
            <Stat label="DNC" value={callKpi.dncProspectCount} />
            <div className="rounded border border-slate-200 bg-white px-2 py-1">
              <div className="text-[10px] text-slate-500">接触率</div>
              <div className="font-semibold text-slate-800">
                {formatRate(callKpi.connectionRate)}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-2 py-1">
              <div className="text-[10px] text-slate-500">アポ率</div>
              <div className="font-semibold text-slate-800">
                {formatRate(callKpi.appointmentRate)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <form className="space-y-2 text-xs" method="get">
        <div className="flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={str(raw, "q") ?? ""}
            placeholder="検索"
            className="rounded border border-slate-200 px-2 py-1"
          />
          <select
            name="stage"
            defaultValue={str(raw, "stage") ?? ""}
            className="rounded border border-slate-200 px-1 py-1"
          >
            <option value="">すべてのstage</option>
            {PROSPECT_MEMBERSHIP_STAGES.map((s) => (
              <option key={s} value={s}>
                {PROSPECT_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            name="assigned"
            defaultValue={str(raw, "assigned") ?? ""}
            className="rounded border border-slate-200 px-1 py-1"
          >
            <option value="">すべての担当</option>
            {activeAssignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              name="unassigned"
              value="1"
              defaultChecked={str(raw, "unassigned") === "1"}
            />
            未割当のみ
          </label>
          <button
            type="submit"
            className="rounded border border-slate-300 px-2 py-1"
          >
            適用
          </button>
        </div>
        <FilterDisclosure appliedCount={advanced}>
          <div className="flex flex-wrap gap-2">
            <input
              name="prefecture"
              defaultValue={str(raw, "prefecture") ?? ""}
              placeholder="都道府県"
              className="rounded border border-slate-200 px-2 py-1"
            />
            <input
              name="industry"
              defaultValue={str(raw, "industry") ?? ""}
              placeholder="業種"
              className="rounded border border-slate-200 px-2 py-1"
            />
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                name="dnc"
                value="1"
                defaultChecked={str(raw, "dnc") === "1"}
              />
              DNC
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                name="duplicate"
                value="1"
                defaultChecked={str(raw, "duplicate") === "1"}
              />
              重複候補
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                name="formalMatch"
                value="1"
                defaultChecked={str(raw, "formalMatch") === "1"}
              />
              正式組織match
            </label>
          </div>
        </FilterDisclosure>
      </form>

      {canAssign ? (
        <BulkAssignPanel
          listId={id}
          membershipIds={items.map((i) => i.membership.id)}
          assignees={activeAssignees}
        />
      ) : null}

      {items.length === 0 ? (
        <CompactEmptyState message="該当する営業候補はありません。" />
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">会社名</th>
                <th className="px-2 py-1.5 font-medium">所在地</th>
                <th className="px-2 py-1.5 font-medium">業種</th>
                <th className="px-2 py-1.5 font-medium">Web</th>
                <th className="px-2 py-1.5 font-medium">電話</th>
                <th className="px-2 py-1.5 font-medium">担当者</th>
                <th className="px-2 py-1.5 font-medium">担当/stage</th>
                <th className="px-2 py-1.5 font-medium">最終接触</th>
                <th className="px-2 py-1.5 font-medium">結果</th>
                <th className="px-2 py-1.5 font-medium">次回</th>
                <th className="px-2 py-1.5 font-medium">架電</th>
                <th className="px-2 py-1.5 font-medium">flag</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ membership, prospect, primaryContactName }) => (
                <tr
                  key={membership.id}
                  className="border-t border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/prospects/${prospect.id}`}
                      className="font-medium text-primary underline"
                    >
                      {prospect.company_name}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">
                    {[prospect.prefecture, prospect.city]
                      .filter(Boolean)
                      .join(" ")}
                  </td>
                  <td className="px-2 py-1.5">{prospect.industry}</td>
                  <td className="max-w-[8rem] truncate px-2 py-1.5">
                    {prospect.normalized_domain ?? prospect.website_url}
                  </td>
                  <td className="px-2 py-1.5">{prospect.main_phone}</td>
                  <td className="px-2 py-1.5">{primaryContactName}</td>
                  <td className="px-2 py-1.5">
                    <MembershipControls
                      membershipId={membership.id}
                      listId={id}
                      stage={membership.stage}
                      assignedUserId={membership.assigned_user_id}
                      assignees={assigneesForCurrent(membership.assigned_user_id)}
                      canEdit={canEdit}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                    {membership.last_contact_at
                      ? formatDateTime(membership.last_contact_at)
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    {membership.last_call_result
                      ? CALL_RESULT_LABELS[
                          membership.last_call_result as CallResult
                        ] ?? membership.last_call_result
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                    {membership.next_contact_at
                      ? formatDateTime(membership.next_contact_at)
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5">{membership.call_count ?? 0}</td>
                  <td className="px-2 py-1.5">
                    {prospect.do_not_contact ? (
                      <span className="text-red-600">DNC</span>
                    ) : null}{" "}
                    {prospect.promotion_status === "completed" ? (
                      <span className="text-emerald-700">正式組織化</span>
                    ) : null}{" "}
                    {prospect.duplicate_review_status === "probable" ? (
                      <span className="text-amber-600">重複?</span>
                    ) : null}{" "}
                    {prospect.formal_org_match_page_id ? (
                      <Link
                        href={`/organizations/${prospect.formal_org_match_page_id}`}
                        className="text-primary underline"
                      >
                        既存組織
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex gap-2 text-xs">
          {page > 1 ? (
            <Link
              href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] ?? "" : v ?? ""])), page: String(page - 1) }).toString()}`}
              className="underline"
            >
              前へ
            </Link>
          ) : null}
          <span>
            {page} / {pageCount}（{total}件）
          </span>
          {page < pageCount ? (
            <Link
              href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] ?? "" : v ?? ""])), page: String(page + 1) }).toString()}`}
              className="underline"
            >
              次へ
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-2 py-1">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="font-semibold text-slate-800">{value}</div>
    </div>
  );
}
