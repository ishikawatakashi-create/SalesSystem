import "server-only";

import type { AppUserRow } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { listRecentViews } from "@/lib/mydesk/recent-views";
import {
  addDaysYmd,
  aggregateCountsByKey,
  aggregateTopStaff,
  bucketActionsByDueDate,
  calcOverdueDays,
  jstToday,
  prioritizeMyActions,
  sumPipelineAmount,
} from "@/lib/mydesk/pure";
import type {
  AdminCompanyStats,
  MyDeskActionItem,
  MyDeskActivityItem,
  MyDeskAlertItem,
  MyDeskDealItem,
  MyDeskSnapshot,
} from "@/lib/mydesk/types";

export { formatYen, jstToday } from "@/lib/mydesk/pure";

type ActionRow = {
  notion_page_id: string;
  external_id: string | null;
  title: string;
  due_date: string | null;
  customer_page_id: string | null;
  deal_page_id: string | null;
  is_open: boolean;
  notion_last_edited_at: string | null;
  assignee_user_id: string | null;
  staff_page_id: string | null;
};

type DealRow = {
  notion_page_id: string;
  title: string;
  customer_page_id: string | null;
  status_semantic: string | null;
  stage_id: string | null;
  expected_amount: number | null;
  next_action_date: string | null;
  next_action: string | null;
  staff_user_ids: string[];
};

type ActivityRow = {
  notion_page_id: string;
  title: string;
  summary: string | null;
  activity_at: string | null;
  customer_page_id: string | null;
  deal_page_id: string | null;
  created_by: string | null;
};

type ComplaintRow = {
  notion_page_id: string;
  title: string;
  summary: string | null;
  customer_page_id: string | null;
  status_semantic: string | null;
  assignee_user_id: string | null;
  staff_page_id: string | null;
  due_date: string | null;
};

type ContractRow = {
  notion_page_id: string;
  title: string;
  customer_page_id: string | null;
  end_date: string | null;
};

/**
 * マイデスク読取(Notion API なし / RLS ユーザークライアント)。
 *
 * ## 自分のアクション
 * action_index で is_open=true かつ:
 * - assignee_user_id = user.id
 * - または (assignee_user_id is null AND staff_page_id = user.notion_staff_page_id)
 *   ※ notion_staff_page_id 未設定時は assignee_user_id のみ
 * assignee 一致を優先。
 *
 * ## 期限バケット(JST YYYY-MM-DD)
 * - overdue: due_date < today
 * - today: due_date = today
 * - upcoming: due_date > today, limit 10, due_date asc
 *
 * ## 自分の案件
 * deal_index: staff_user_ids contains user.id, status_semantic in (active,on_hold), limit 20
 *
 * ## KPI / Alerts / Admin は同フィルタ基準。日本語ステータス名は使わない。
 */
export async function loadMyDesk(user: AppUserRow): Promise<MyDeskSnapshot> {
  const supabase = await createClient();
  const today = jstToday();
  const in7 = addDaysYmd(today, 7);
  const in30 = addDaysYmd(today, 30);
  const last7Iso = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // --- 自分のオープンアクション ---
  let actionQuery = supabase
    .from("action_index")
    .select(
      "notion_page_id,external_id,title,due_date,customer_page_id,deal_page_id,is_open,notion_last_edited_at,assignee_user_id,staff_page_id",
    )
    .eq("is_open", true)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(200);

  if (user.notion_staff_page_id) {
    actionQuery = actionQuery.or(
      `assignee_user_id.eq.${user.id},and(assignee_user_id.is.null,staff_page_id.eq.${user.notion_staff_page_id})`,
    );
  } else {
    actionQuery = actionQuery.eq("assignee_user_id", user.id);
  }

  // --- 自分の案件(集計用に多め、表示は後で20件) ---
  const myDealsQuery = supabase
    .from("deal_index")
    .select(
      "notion_page_id,title,customer_page_id,status_semantic,stage_id,expected_amount,next_action_date,next_action,staff_user_ids",
    )
    .contains("staff_user_ids", [user.id])
    .in("status_semantic", ["active", "on_hold"])
    .order("next_action_date", { ascending: true, nullsFirst: false })
    .limit(500);

  // --- 最近の対応(個人優先) ---
  const myActivitiesQuery = supabase
    .from("activity_index")
    .select(
      "notion_page_id,title,summary,activity_at,customer_page_id,deal_page_id,created_by",
    )
    .eq("created_by", user.id)
    .order("activity_at", { ascending: false, nullsFirst: false })
    .limit(8);

  // --- オープンクレーム(個人) ---
  let myComplaintsQuery = supabase
    .from("complaint_index")
    .select(
      "notion_page_id,title,summary,customer_page_id,status_semantic,assignee_user_id,staff_page_id,due_date",
    )
    .in("status_semantic", ["open", "in_progress"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(50);

  if (user.notion_staff_page_id) {
    myComplaintsQuery = myComplaintsQuery.or(
      `assignee_user_id.eq.${user.id},and(assignee_user_id.is.null,staff_page_id.eq.${user.notion_staff_page_id})`,
    );
  } else {
    myComplaintsQuery = myComplaintsQuery.eq("assignee_user_id", user.id);
  }

  // --- 契約終了間近 ---
  const endingContractsQuery = supabase
    .from("contract_index")
    .select("notion_page_id,title,customer_page_id,end_date")
    .not("end_date", "is", null)
    .gte("end_date", today)
    .lte("end_date", in30)
    .order("end_date", { ascending: true })
    .limit(5);

  // --- 直近7日の自分の対応件数 ---
  const recentActivityCountQuery = supabase
    .from("activity_index")
    .select("notion_page_id", { count: "exact", head: true })
    .eq("created_by", user.id)
    .gte("activity_at", last7Iso);

  const recentViewsPromise = listRecentViews(user.id, 8);

  const [
    actionsRes,
    dealsRes,
    activitiesRes,
    complaintsRes,
    contractsRes,
    recentActivityCountRes,
    recentViews,
  ] = await Promise.all([
    actionQuery,
    myDealsQuery,
    myActivitiesQuery,
    myComplaintsQuery,
    endingContractsQuery,
    recentActivityCountQuery,
    recentViewsPromise,
  ]);

  if (actionsRes.error) {
    throw new Error("マイデスク: アクション取得に失敗しました");
  }
  if (dealsRes.error) {
    throw new Error("マイデスク: 案件取得に失敗しました");
  }
  if (activitiesRes.error) {
    throw new Error("マイデスク: 対応履歴取得に失敗しました");
  }
  if (complaintsRes.error) {
    throw new Error("マイデスク: クレーム取得に失敗しました");
  }
  // 契約 end_date が無い環境でも落とさない
  const contractRows = (contractsRes.error
    ? []
    : (contractsRes.data ?? [])) as unknown as ContractRow[];

  const actionRows = (actionsRes.data ?? []) as unknown as ActionRow[];
  const dealRows = (dealsRes.data ?? []) as unknown as DealRow[];
  const activityRows = (activitiesRes.data ?? []) as unknown as ActivityRow[];
  const complaintRows = (complaintsRes.data ?? []) as unknown as ComplaintRow[];

  // 自分の対応が少ない場合は会社全体(RLS範囲)で補完
  if (activityRows.length < 8) {
    const { data: companyActs } = await supabase
      .from("activity_index")
      .select(
        "notion_page_id,title,summary,activity_at,customer_page_id,deal_page_id,created_by",
      )
      .order("activity_at", { ascending: false, nullsFirst: false })
      .limit(8);
    const seen = new Set(activityRows.map((r) => r.notion_page_id));
    for (const row of (companyActs ?? []) as unknown as ActivityRow[]) {
      if (seen.has(row.notion_page_id)) continue;
      activityRows.push(row);
      if (activityRows.length >= 8) break;
    }
  }

  const prioritized = prioritizeMyActions(
    actionRows.map((r) => ({
      ...r,
      assigneeUserId: r.assignee_user_id,
      dueDate: r.due_date,
    })),
    user.id,
  );

  const buckets = bucketActionsByDueDate(prioritized, today, 10);

  // 表示用ラベル一括解決(N+1回避 / user client)
  const customerIds = new Set<string>();
  const dealIds = new Set<string>();
  const stageIds = new Set<string>();
  for (const r of prioritized) {
    if (r.customer_page_id) customerIds.add(r.customer_page_id);
    if (r.deal_page_id) dealIds.add(r.deal_page_id);
  }
  for (const r of dealRows) {
    if (r.customer_page_id) customerIds.add(r.customer_page_id);
    if (r.stage_id) stageIds.add(r.stage_id);
  }
  for (const r of activityRows) {
    if (r.customer_page_id) customerIds.add(r.customer_page_id);
    if (r.deal_page_id) dealIds.add(r.deal_page_id);
  }
  for (const r of complaintRows) {
    if (r.customer_page_id) customerIds.add(r.customer_page_id);
  }
  for (const r of contractRows) {
    if (r.customer_page_id) customerIds.add(r.customer_page_id);
  }

  const [customersRes, dealsLabelRes, stagesRes] = await Promise.all([
    customerIds.size === 0
      ? Promise.resolve({ data: [] as Array<{ notion_page_id: string; display_name: string }>, error: null })
      : supabase
          .from("customer_index")
          .select("notion_page_id,display_name")
          .in("notion_page_id", [...customerIds]),
    dealIds.size === 0
      ? Promise.resolve({ data: [] as Array<{ notion_page_id: string; title: string }>, error: null })
      : supabase
          .from("deal_index")
          .select("notion_page_id,title")
          .in("notion_page_id", [...dealIds]),
    stageIds.size === 0
      ? Promise.resolve({ data: [] as Array<{ notion_page_id: string; name: string }>, error: null })
      : supabase
          .from("masters_cache")
          .select("notion_page_id,name")
          .in("notion_page_id", [...stageIds]),
  ]);

  const customerNames = new Map<string, string>();
  for (const c of (customersRes.data ?? []) as Array<{
    notion_page_id: string;
    display_name: string;
  }>) {
    customerNames.set(c.notion_page_id, c.display_name);
  }
  const dealTitles = new Map<string, string>();
  for (const d of (dealsLabelRes.data ?? []) as Array<{
    notion_page_id: string;
    title: string;
  }>) {
    dealTitles.set(d.notion_page_id, d.title);
  }
  const stageNames = new Map<string, string>();
  for (const s of (stagesRes.data ?? []) as Array<{
    notion_page_id: string;
    name: string;
  }>) {
    stageNames.set(s.notion_page_id, s.name);
  }

  const toActionItem = (
    r: (typeof prioritized)[number],
  ): MyDeskActionItem => ({
    pageId: r.notion_page_id,
    externalId: r.external_id,
    title: r.title || "(無題)",
    dueDate: r.due_date,
    overdueDays: calcOverdueDays(r.due_date, today),
    customerPageId: r.customer_page_id,
    customerName: r.customer_page_id
      ? (customerNames.get(r.customer_page_id) ?? null)
      : null,
    dealPageId: r.deal_page_id,
    dealTitle: r.deal_page_id
      ? (dealTitles.get(r.deal_page_id) ?? null)
      : null,
    isOpen: r.is_open,
    lastEditedTime: r.notion_last_edited_at,
    assigneeMatched: r.assignee_user_id === user.id,
  });

  const overdueActions = buckets.overdue.map(toActionItem);
  const todayActions = buckets.todayItems.map(toActionItem);
  const upcomingActions = buckets.upcoming.map(toActionItem);

  const pipeline = sumPipelineAmount(dealRows);
  const activeDeals = dealRows.filter((d) => d.status_semantic === "active");
  const onHoldDeals = dealRows.filter((d) => d.status_semantic === "on_hold");

  const myDeals: MyDeskDealItem[] = dealRows.slice(0, 20).map((d) => ({
    pageId: d.notion_page_id,
    title: d.title || "(無題)",
    customerPageId: d.customer_page_id,
    customerName: d.customer_page_id
      ? (customerNames.get(d.customer_page_id) ?? null)
      : null,
    statusSemantic: d.status_semantic,
    stageId: d.stage_id,
    stageName: d.stage_id ? (stageNames.get(d.stage_id) ?? null) : null,
    expectedAmount: d.expected_amount,
    nextActionDate: d.next_action_date,
    nextAction: d.next_action,
  }));

  const recentActivities: MyDeskActivityItem[] = activityRows
    .slice(0, 8)
    .map((a) => ({
      pageId: a.notion_page_id,
      title: a.title || "(無題)",
      summary: a.summary,
      activityAt: a.activity_at,
      customerPageId: a.customer_page_id,
      customerName: a.customer_page_id
        ? (customerNames.get(a.customer_page_id) ?? null)
        : null,
      dealPageId: a.deal_page_id,
      dealTitle: a.deal_page_id
        ? (dealTitles.get(a.deal_page_id) ?? null)
        : null,
      createdBy: a.created_by,
    }));

  const alerts: MyDeskAlertItem[] = [];
  for (const c of complaintRows.slice(0, 5)) {
    alerts.push({
      kind: "open_complaint",
      title: c.title || "(無題)",
      subtitle: c.customer_page_id
        ? (customerNames.get(c.customer_page_id) ?? null)
        : (c.summary ?? null),
      href: `/complaints/${c.notion_page_id}`,
    });
  }
  if (buckets.overdue.length > 0) {
    alerts.push({
      kind: "overdue_actions",
      title: `期限超過のアクションが ${buckets.overdue.length} 件あります`,
      subtitle: "未完了の期限超過を確認してください",
      href: `/actions?view=today-overdue&assignee=${user.id}`,
      count: buckets.overdue.length,
    });
  }
  const soonDeals = dealRows
    .filter(
      (d) =>
        d.next_action_date &&
        d.next_action_date >= today &&
        d.next_action_date <= in7,
    )
    .slice(0, 5);
  for (const d of soonDeals) {
    alerts.push({
      kind: "deal_next_action",
      title: d.title || "(無題)",
      subtitle: `次回予定 ${d.next_action_date}${d.next_action ? ` / ${d.next_action}` : ""}`,
      href: `/deals/${d.notion_page_id}`,
    });
  }
  for (const c of contractRows) {
    alerts.push({
      kind: "contract_ending",
      title: c.title || "(無題)",
      subtitle: c.end_date
        ? `終了日 ${c.end_date}${
            c.customer_page_id
              ? ` / ${customerNames.get(c.customer_page_id) ?? ""}`
              : ""
          }`
        : null,
      href: `/contracts/${c.notion_page_id}`,
    });
  }

  let adminCompanyStats: AdminCompanyStats | null = null;
  if (user.role === "admin") {
    adminCompanyStats = await loadAdminCompanyStats(supabase, today, last7Iso);
  }

  const [newInquiriesRes, unassignedNewRes, prospectAssignedNewRes] =
    await Promise.all([
      supabase
        .from("inquiries")
        .select("id", { count: "exact", head: true })
        .eq("status", "new")
        .eq("historical_import", false)
        .eq("ingest_classification", "source"),
      supabase
        .from("inquiries")
        .select("id", { count: "exact", head: true })
        .eq("status", "new")
        .eq("historical_import", false)
        .eq("ingest_classification", "source")
        .is("assigned_user_id", null),
      supabase
        .from("prospect_list_memberships")
        .select("id", { count: "exact", head: true })
        .eq("assigned_user_id", user.id)
        .eq("stage", "new")
        .is("archived_at", null),
    ]);

  return {
    today,
    kpis: {
      openActions: prioritized.length,
      overdueActions: buckets.overdue.length,
      todayActions: buckets.todayItems.length,
      activeDeals: activeDeals.length,
      onHoldDeals: onHoldDeals.length,
      pipelineAmount: pipeline.sum,
      pipelineAmountNullCount: pipeline.nullCount,
      openComplaints: complaintRows.length,
      recentActivityCount: recentActivityCountRes.count ?? 0,
    },
    overdueActions,
    todayActions,
    upcomingActions,
    myDeals,
    recentActivities,
    alerts,
    recentViews: recentViews.map((r) => ({
      customerPageId: r.customerPageId,
      customerName: r.customerName,
      viewedAt: r.viewedAt,
    })),
    adminCompanyStats,
    inquiries: {
      newCount: newInquiriesRes.count ?? 0,
      unassignedNewCount: unassignedNewRes.count ?? 0,
    },
    prospects: {
      assignedNewCount: prospectAssignedNewRes.count ?? 0,
    },
  };
}

async function loadAdminCompanyStats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  today: string,
  last7Iso: string,
): Promise<AdminCompanyStats> {
  const dealsQuery = supabase
    .from("deal_index")
    .select(
      "notion_page_id,status_semantic,stage_id,expected_amount,staff_user_ids",
    )
    .in("status_semantic", ["active", "on_hold"])
    .limit(500);

  const [
    dealsRes,
    allStatusRes,
    activityCountRes,
    overdueActionsRes,
    openComplaintsRes,
  ] = await Promise.all([
    dealsQuery,
    supabase
      .from("deal_index")
      .select("status_semantic")
      .not("status_semantic", "is", null)
      .limit(2000),
    supabase
      .from("activity_index")
      .select("notion_page_id", { count: "exact", head: true })
      .gte("activity_at", last7Iso),
    supabase
      .from("action_index")
      .select("notion_page_id", { count: "exact", head: true })
      .eq("is_open", true)
      .lt("due_date", today),
    supabase
      .from("complaint_index")
      .select("notion_page_id", { count: "exact", head: true })
      .in("status_semantic", ["open", "in_progress"]),
  ]);

  const pipelineDeals = (dealsRes.data ?? []) as unknown as Array<{
    notion_page_id: string;
    status_semantic: string | null;
    stage_id: string | null;
    expected_amount: number | null;
    staff_user_ids: string[];
  }>;

  const pipeline = sumPipelineAmount(pipelineDeals);
  const statusCounts = aggregateCountsByKey(
    ((allStatusRes.data ?? []) as Array<{ status_semantic: string | null }>).map(
      (r) => r.status_semantic,
    ),
  );
  const dealsByStatus = [...statusCounts.entries()]
    .map(([statusSemantic, count]) => ({ statusSemantic, count }))
    .sort((a, b) => b.count - a.count || a.statusSemantic.localeCompare(b.statusSemantic));

  const stageCounts = aggregateCountsByKey(
    pipelineDeals.map((d) => d.stage_id),
  );
  const topStages = [...stageCounts.entries()]
    .map(([stageId, count]) => ({ stageId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const stageIds = topStages.map((s) => s.stageId);
  const staffAgg = aggregateTopStaff(
    pipelineDeals.map((d) => d.staff_user_ids ?? []),
    10,
  );
  const staffIds = staffAgg.map((s) => s.userId);

  const [stagesRes, staffRes] = await Promise.all([
    stageIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ notion_page_id: string; name: string }> })
      : supabase
          .from("masters_cache")
          .select("notion_page_id,name")
          .in("notion_page_id", stageIds),
    staffIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; display_name: string }> })
      : supabase
          .from("app_users")
          .select("id,display_name")
          .in("id", staffIds),
  ]);

  const stageNameMap = new Map<string, string>();
  for (const s of (stagesRes.data ?? []) as Array<{
    notion_page_id: string;
    name: string;
  }>) {
    stageNameMap.set(s.notion_page_id, s.name);
  }
  const staffNameMap = new Map<string, string>();
  for (const u of (staffRes.data ?? []) as Array<{
    id: string;
    display_name: string;
  }>) {
    staffNameMap.set(u.id, u.display_name);
  }

  return {
    dealsByStatus,
    pipelineAmount: pipeline.sum,
    pipelineAmountNullCount: pipeline.nullCount,
    dealsByStage: topStages.map((s) => ({
      stageId: s.stageId,
      stageName: stageNameMap.get(s.stageId) ?? null,
      count: s.count,
    })),
    staffBreakdown: staffAgg.map((s) => ({
      userId: s.userId,
      displayName: staffNameMap.get(s.userId) ?? null,
      count: s.count,
    })),
    activityCountLast7Days: activityCountRes.count ?? 0,
    overdueOpenActions: overdueActionsRes.count ?? 0,
    openComplaints: openComplaintsRes.count ?? 0,
  };
}
