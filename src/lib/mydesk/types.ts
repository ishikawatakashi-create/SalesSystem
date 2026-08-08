/** マイデスクスナップショット型 */

export type MyDeskKpis = {
  openActions: number;
  overdueActions: number;
  todayActions: number;
  activeDeals: number;
  onHoldDeals: number;
  pipelineAmount: number;
  pipelineAmountNullCount: number;
  openComplaints: number;
  recentActivityCount: number;
};

export type MyDeskActionItem = {
  pageId: string;
  externalId: string | null;
  title: string;
  dueDate: string | null;
  overdueDays: number | null;
  customerPageId: string | null;
  customerName: string | null;
  dealPageId: string | null;
  dealTitle: string | null;
  isOpen: boolean;
  lastEditedTime: string | null;
  /** assignee_user_id 一致なら true(staff_page フォールバック由来は false) */
  assigneeMatched: boolean;
};

export type MyDeskDealItem = {
  pageId: string;
  title: string;
  customerPageId: string | null;
  customerName: string | null;
  statusSemantic: string | null;
  stageId: string | null;
  stageName: string | null;
  expectedAmount: number | null;
  nextActionDate: string | null;
  nextAction: string | null;
};

export type MyDeskActivityItem = {
  pageId: string;
  title: string;
  summary: string | null;
  activityAt: string | null;
  customerPageId: string | null;
  customerName: string | null;
  dealPageId: string | null;
  dealTitle: string | null;
  createdBy: string | null;
};

export type MyDeskAlertKind =
  | "open_complaint"
  | "overdue_actions"
  | "deal_next_action"
  | "contract_ending";

export type MyDeskAlertItem = {
  kind: MyDeskAlertKind;
  title: string;
  subtitle: string | null;
  href: string;
  /** 件数アラート用(任意) */
  count?: number;
};

export type MyDeskRecentViewItem = {
  customerPageId: string;
  customerName: string | null;
  viewedAt: string;
};

export type AdminCompanyStats = {
  dealsByStatus: Array<{ statusSemantic: string; count: number }>;
  pipelineAmount: number;
  pipelineAmountNullCount: number;
  dealsByStage: Array<{
    stageId: string;
    stageName: string | null;
    count: number;
  }>;
  staffBreakdown: Array<{
    userId: string;
    displayName: string | null;
    count: number;
  }>;
  activityCountLast7Days: number;
  overdueOpenActions: number;
  openComplaints: number;
};

export type MyDeskInquirySummary = {
  newCount: number;
  unassignedNewCount: number;
};

export type MyDeskProspectSummary = {
  /** 自分に割当済み・未着手(new) */
  assignedNewCount: number;
};

export type MyDeskSnapshot = {
  today: string;
  kpis: MyDeskKpis;
  overdueActions: MyDeskActionItem[];
  todayActions: MyDeskActionItem[];
  upcomingActions: MyDeskActionItem[];
  myDeals: MyDeskDealItem[];
  recentActivities: MyDeskActivityItem[];
  alerts: MyDeskAlertItem[];
  recentViews: MyDeskRecentViewItem[];
  adminCompanyStats: AdminCompanyStats | null;
  inquiries: MyDeskInquirySummary;
  prospects: MyDeskProspectSummary;
};
