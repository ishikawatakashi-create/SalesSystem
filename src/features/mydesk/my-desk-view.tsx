import Link from "next/link";

import { CompactEmptyState } from "@/components/ui/compact-empty-state";
import { EmptyState } from "@/components/ui/state-messages";
import { CompleteActionButton } from "@/features/actions/complete-button";
import { formatDate, formatDateTime } from "@/features/customers/format";
import { formatYen } from "@/lib/mydesk/pure";
import type { MyDeskActionItem, MyDeskSnapshot } from "@/lib/mydesk/types";
import type { AppUserRow } from "@/types/database";

const STATUS_LABEL: Record<string, string> = {
  active: "進行中",
  on_hold: "保留",
  won: "受注",
  lost: "失注",
};

type TodoBadge = "overdue" | "today" | "upcoming";

const TODO_BADGE: Record<
  TodoBadge,
  { label: string; className: string }
> = {
  overdue: {
    label: "期限超過",
    className: "bg-red-100 text-red-700",
  },
  today: {
    label: "今日",
    className: "bg-amber-100 text-amber-800",
  },
  upcoming: {
    label: "今後",
    className: "bg-slate-100 text-slate-600",
  },
};

function statusLabel(semantic: string | null): string {
  if (!semantic) return "—";
  return STATUS_LABEL[semantic] ?? semantic;
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function TodoActionTable({
  rows,
  canEditActions,
}: {
  rows: Array<MyDeskActionItem & { badge: TodoBadge }>;
  canEditActions: boolean;
}) {
  if (rows.length === 0) {
    return (
      <CompactEmptyState
        message="今日やることはありません。"
        actionHref="/actions"
        actionLabel="すべて見る"
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="w-full whitespace-nowrap text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
            <th className="px-2 py-1.5 font-medium">区分</th>
            <th className="px-2 py-1.5 font-medium">期限</th>
            <th className="px-2 py-1.5 font-medium">内容</th>
            <th className="px-2 py-1.5 font-medium">顧客</th>
            <th className="px-2 py-1.5 font-medium">案件</th>
            {canEditActions && (
              <th className="px-2 py-1.5 font-medium">操作</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const badge = TODO_BADGE[row.badge];
            return (
              <tr
                key={row.pageId}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="px-2 py-1.5">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </td>
                <td
                  className={`px-2 py-1.5 ${
                    row.badge === "overdue"
                      ? "font-medium text-red-700"
                      : ""
                  }`}
                >
                  {formatDate(row.dueDate)}
                  {row.overdueDays != null && (
                    <span className="ml-1 text-[10px] text-red-600">
                      (+{row.overdueDays}日)
                    </span>
                  )}
                </td>
                <td className="max-w-48 truncate px-2 py-1.5 font-medium">
                  <Link
                    href={`/actions/${row.pageId}`}
                    className="text-primary hover:underline"
                  >
                    {row.title}
                  </Link>
                </td>
                <td className="max-w-36 truncate px-2 py-1.5">
                  {row.customerPageId ? (
                    <Link
                      href={`/customers/${row.customerPageId}`}
                      className="text-primary hover:underline"
                    >
                      {row.customerName ?? "(不明)"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-36 truncate px-2 py-1.5">
                  {row.dealPageId ? (
                    <Link
                      href={`/deals/${row.dealPageId}`}
                      className="text-primary hover:underline"
                    >
                      {row.dealTitle ?? "(不明)"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                {canEditActions && (
                  <td className="px-2 py-1.5">
                    {row.isOpen &&
                    row.externalId &&
                    row.lastEditedTime ? (
                      <CompleteActionButton
                        notionPageId={row.pageId}
                        externalId={row.externalId}
                        lastEditedTime={row.lastEditedTime}
                        compact
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SimpleBar({
  label,
  count,
  max,
  href,
}: {
  label: string;
  count: number;
  max: number;
  href?: string;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-slate-700">{label}</span>
        <span className="shrink-0 tabular-nums text-slate-600">{count}</span>
      </div>
      <div className="mt-0.5 h-1.5 w-full rounded-sm bg-slate-100">
        <div
          className="h-1.5 rounded-sm bg-slate-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="block py-1 hover:bg-slate-50">
        {inner}
      </Link>
    );
  }
  return <div className="py-1">{inner}</div>;
}

export function MyDeskView({
  snapshot,
  user,
  canEditActions,
}: {
  snapshot: MyDeskSnapshot;
  user: AppUserRow;
  canEditActions: boolean;
}) {
  const { kpis, adminCompanyStats } = snapshot;
  const stageMax = Math.max(
    ...(adminCompanyStats?.dealsByStage.map((s) => s.count) ?? [0]),
    1,
  );
  const staffMax = Math.max(
    ...(adminCompanyStats?.staffBreakdown.map((s) => s.count) ?? [0]),
    1,
  );
  const statusMax = Math.max(
    ...(adminCompanyStats?.dealsByStatus.map((s) => s.count) ?? [0]),
    1,
  );

  const todoRows: Array<MyDeskActionItem & { badge: TodoBadge }> = [
    ...snapshot.overdueActions.map((r) => ({ ...r, badge: "overdue" as const })),
    ...snapshot.todayActions.map((r) => ({ ...r, badge: "today" as const })),
    ...snapshot.upcomingActions.map((r) => ({
      ...r,
      badge: "upcoming" as const,
    })),
  ];

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-slate-900">マイデスク</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {user.display_name} / 基準日 {snapshot.today}(JST)
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Link
            href="/customers/new"
            className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50"
          >
            +新規顧客
          </Link>
          <Link
            href="/actions/new"
            className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50"
          >
            +アクション
          </Link>
        </div>
      </div>

      {/* Primary KPI */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi
          label="期限超過"
          value={kpis.overdueActions}
          href={`/actions?view=today-overdue&assignee=${user.id}`}
          danger={kpis.overdueActions > 0}
        />
        <Kpi
          label="本日期限"
          value={kpis.todayActions}
          href={`/actions?view=today-overdue&assignee=${user.id}`}
        />
        <Kpi
          label="進行中案件"
          value={kpis.activeDeals}
          href="/deals?semantic=active"
        />
        <Kpi
          label="見込み金額"
          value={formatYen(kpis.pipelineAmount)}
          href="/deals"
          hint={
            kpis.pipelineAmountNullCount > 0
              ? `未入力 ${kpis.pipelineAmountNullCount}件`
              : undefined
          }
        />
      </div>

      {/* Secondary KPI */}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiSecondary
          label="未完了"
          value={kpis.openActions}
          href={`/actions?view=all&assignee=${user.id}&open=1`}
        />
        <KpiSecondary
          label="保留案件"
          value={kpis.onHoldDeals}
          href="/deals?semantic=on_hold"
        />
        <KpiSecondary
          label="未解決クレーム"
          value={kpis.openComplaints}
          href="/complaints"
          danger={kpis.openComplaints > 0}
        />
        <KpiSecondary
          label="7日対応"
          value={kpis.recentActivityCount}
          href="/activities"
        />
      </div>

      <Section
        title="今日やること"
        action={
          <Link
            href="/actions"
            className="text-xs text-primary hover:underline"
          >
            すべて見る
          </Link>
        }
      >
        <TodoActionTable rows={todoRows} canEditActions={canEditActions} />
      </Section>

      <Section
        title="自分の案件"
        action={
          <Link href="/deals" className="text-xs text-primary hover:underline">
            一覧へ
          </Link>
        }
      >
        {snapshot.myDeals.length === 0 ? (
          <EmptyState
            title="担当案件はありません"
            hint="案件の自社担当者に自分が含まれている進行中・保留案件が表示されます。"
            actionHref="/deals"
            actionLabel="案件一覧へ"
          />
        ) : (
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full whitespace-nowrap text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                  <th className="px-2 py-1.5 font-medium">案件</th>
                  <th className="px-2 py-1.5 font-medium">顧客</th>
                  <th className="px-2 py-1.5 font-medium">状態</th>
                  <th className="px-2 py-1.5 font-medium">ステージ</th>
                  <th className="px-2 py-1.5 font-medium">見込み</th>
                  <th className="px-2 py-1.5 font-medium">次回予定</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.myDeals.map((d) => (
                  <tr
                    key={d.pageId}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="max-w-48 truncate px-2 py-1.5 font-medium">
                      <Link
                        href={`/deals/${d.pageId}`}
                        className="text-primary hover:underline"
                      >
                        {d.title}
                      </Link>
                    </td>
                    <td className="max-w-36 truncate px-2 py-1.5">
                      {d.customerPageId ? (
                        <Link
                          href={`/customers/${d.customerPageId}`}
                          className="text-primary hover:underline"
                        >
                          {d.customerName ?? "(不明)"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {statusLabel(d.statusSemantic)}
                    </td>
                    <td className="px-2 py-1.5">{d.stageName ?? "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {formatYen(d.expectedAmount)}
                    </td>
                    <td className="px-2 py-1.5">
                      {formatDate(d.nextActionDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="最近の対応"
        action={
          <Link
            href="/activities"
            className="text-xs text-primary hover:underline"
          >
            一覧へ
          </Link>
        }
      >
        {snapshot.recentActivities.length === 0 ? (
          <EmptyState
            title="最近の対応はありません"
            actionHref="/activities"
            actionLabel="対応履歴一覧へ"
          />
        ) : (
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full whitespace-nowrap text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                  <th className="px-2 py-1.5 font-medium">日時</th>
                  <th className="px-2 py-1.5 font-medium">内容</th>
                  <th className="px-2 py-1.5 font-medium">顧客</th>
                  <th className="px-2 py-1.5 font-medium">案件</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recentActivities.map((a) => (
                  <tr
                    key={a.pageId}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-2 py-1.5">
                      {formatDateTime(a.activityAt)}
                    </td>
                    <td className="max-w-56 truncate px-2 py-1.5 font-medium">
                      <Link
                        href={`/activities/${a.pageId}`}
                        className="text-primary hover:underline"
                      >
                        {a.title}
                      </Link>
                    </td>
                    <td className="max-w-36 truncate px-2 py-1.5">
                      {a.customerPageId ? (
                        <Link
                          href={`/customers/${a.customerPageId}`}
                          className="text-primary hover:underline"
                        >
                          {a.customerName ?? "(不明)"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-36 truncate px-2 py-1.5">
                      {a.dealPageId ? (
                        <Link
                          href={`/deals/${a.dealPageId}`}
                          className="text-primary hover:underline"
                        >
                          {a.dealTitle ?? "(不明)"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="要確認">
        {snapshot.alerts.length === 0 ? (
          <EmptyState title="要確認の項目はありません" />
        ) : (
          <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white text-xs">
            {snapshot.alerts.map((alert, i) => (
              <li key={`${alert.kind}-${alert.href}-${i}`}>
                <Link
                  href={alert.href}
                  className="flex items-start justify-between gap-3 px-3 py-2 hover:bg-slate-50"
                >
                  <span>
                    <span className="font-medium text-slate-800">
                      {alert.title}
                    </span>
                    {alert.subtitle && (
                      <span className="mt-0.5 block text-slate-500">
                        {alert.subtitle}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-slate-400">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {snapshot.recentViews.length > 0 && (
        <Section title="最近閲覧した顧客">
          <ul className="flex flex-wrap gap-x-3 gap-y-1 rounded border border-slate-200 bg-white px-3 py-2 text-xs">
            {snapshot.recentViews.map((v) => (
              <li key={v.customerPageId}>
                <Link
                  href={`/customers/${v.customerPageId}`}
                  className="text-primary hover:underline"
                >
                  {v.customerName ?? "(不明)"}
                </Link>
                <span className="ml-1 text-slate-400">
                  {formatDateTime(v.viewedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {adminCompanyStats && (
        <Section title="会社全体(管理者)">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-xs font-semibold text-slate-700">
                サマリ
              </h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-slate-500">7日対応件数</dt>
                <dd className="tabular-nums text-right">
                  {adminCompanyStats.activityCountLast7Days}
                </dd>
                <dt className="text-slate-500">期限超過アクション</dt>
                <dd className="tabular-nums text-right text-red-700">
                  {adminCompanyStats.overdueOpenActions}
                </dd>
                <dt className="text-slate-500">未解決クレーム</dt>
                <dd className="tabular-nums text-right">
                  {adminCompanyStats.openComplaints}
                </dd>
                <dt className="text-slate-500">見込み合計(進行+保留)</dt>
                <dd className="tabular-nums text-right">
                  {formatYen(adminCompanyStats.pipelineAmount)}
                </dd>
              </dl>
            </div>
            <div className="rounded border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-xs font-semibold text-slate-700">
                案件ステータス別
              </h3>
              {adminCompanyStats.dealsByStatus.length === 0 ? (
                <p className="text-xs text-slate-500">データなし</p>
              ) : (
                adminCompanyStats.dealsByStatus.map((s) => (
                  <SimpleBar
                    key={s.statusSemantic}
                    label={statusLabel(s.statusSemantic)}
                    count={s.count}
                    max={statusMax}
                    href={`/deals?semantic=${encodeURIComponent(s.statusSemantic)}`}
                  />
                ))
              )}
            </div>
            <div className="rounded border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-xs font-semibold text-slate-700">
                ステージ別(進行+保留)
              </h3>
              {adminCompanyStats.dealsByStage.length === 0 ? (
                <p className="text-xs text-slate-500">データなし</p>
              ) : (
                adminCompanyStats.dealsByStage.map((s) => (
                  <SimpleBar
                    key={s.stageId}
                    label={s.stageName ?? "(不明)"}
                    count={s.count}
                    max={stageMax}
                  />
                ))
              )}
            </div>
            <div className="rounded border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-xs font-semibold text-slate-700">
                担当者別(先頭担当・進行+保留)
              </h3>
              {adminCompanyStats.staffBreakdown.length === 0 ? (
                <p className="text-xs text-slate-500">データなし</p>
              ) : (
                adminCompanyStats.staffBreakdown.map((s) => (
                  <SimpleBar
                    key={s.userId}
                    label={s.displayName ?? "(不明)"}
                    count={s.count}
                    max={staffMax}
                  />
                ))
              )}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  href,
  danger,
  hint,
}: {
  label: string;
  value: number | string;
  href: string;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className="rounded border border-slate-200 bg-white px-2.5 py-2 hover:bg-slate-50"
    >
      <div className="text-[11px] text-slate-500">{label}</div>
      <div
        className={`mt-0.5 text-lg font-semibold tabular-nums leading-tight ${
          danger ? "text-red-700" : "text-slate-900"
        }`}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-slate-400">{hint}</div>
      )}
    </Link>
  );
}

function KpiSecondary({
  label,
  value,
  href,
  danger,
}: {
  label: string;
  value: number | string;
  href: string;
  danger?: boolean;
}) {
  return (
    <Link
      href={href}
      className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5 hover:bg-slate-100"
    >
      <div className="text-[10px] text-slate-400">{label}</div>
      <div
        className={`mt-0.5 text-sm font-medium tabular-nums leading-tight ${
          danger ? "text-red-600" : "text-slate-600"
        }`}
      >
        {value}
      </div>
    </Link>
  );
}
