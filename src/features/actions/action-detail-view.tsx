import Link from "next/link";

import type { ActionDetail } from "@/lib/actions/types";
import { isActionOpenSemantic } from "@/lib/actions/types";
import {
  formatDate,
  formatDateTime,
  formatOptional,
  overdueDaysTokyo,
} from "@/features/actions/format";
import type { DetailLabelMaps } from "@/features/actions/list-data";
import { CompleteActionButton } from "@/features/actions/complete-button";

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1">
      <dt className="w-32 shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="text-xs text-slate-900">{value ?? "—"}</dd>
    </div>
  );
}

function withInactive(
  name: string | null,
  inactive: boolean,
): React.ReactNode {
  if (!name) return "—";
  return (
    <span>
      {name}
      {inactive && (
        <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">
          無効
        </span>
      )}
    </span>
  );
}

export function ActionDetailView({
  detail,
  labels,
  canEdit,
  savedNote,
}: {
  detail: ActionDetail;
  labels: DetailLabelMaps;
  canEdit: boolean;
  savedNote?: boolean;
}) {
  const overdue = isActionOpenSemantic(labels.statusSemantic)
    ? overdueDaysTokyo(detail.dueDate)
    : null;

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      {savedNote && (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          保存しました。顧客・案件の次回アクション表示は再計算される場合があります。
        </div>
      )}

      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">{detail.title || "(無題)"}</h1>
        {overdue != null && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
            {overdue}日超過
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs">
          {canEdit && isActionOpenSemantic(labels.statusSemantic) && (
            <CompleteActionButton
              notionPageId={detail.notionPageId}
              externalId={detail.externalId}
              lastEditedTime={detail.lastEditedTime}
            />
          )}
          {canEdit && (
            <Link
              href={`/actions/${detail.notionPageId}/edit`}
              className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover"
            >
              編集
            </Link>
          )}
          <Link
            href="/actions"
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
            <Item label="内容" value={detail.title || "(無題)"} />
            <Item
              label="期限"
              value={
                <span className={overdue ? "text-red-700" : undefined}>
                  {formatDate(detail.dueDate)}
                </span>
              }
            />
            <Item
              label="状態"
              value={withInactive(labels.statusName, labels.statusInactive)}
            />
            <Item
              label="優先度"
              value={withInactive(
                labels.priorityName,
                labels.priorityInactive,
              )}
            />
            <Item
              label="完了日時"
              value={formatDateTime(detail.completedAt)}
            />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">関連</h2>
          <dl className="divide-y divide-slate-100">
            <Item
              label="顧客アカウント"
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
            <Item
              label="関連案件"
              value={
                detail.dealPageId ? (
                  <Link
                    href={`/deals/${detail.dealPageId}`}
                    className="text-primary underline"
                  >
                    {labels.dealTitle ?? "(不明)"}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <Item
              label="元対応履歴"
              value={
                detail.activityPageId ? (
                  <Link
                    href={`/activities/${detail.activityPageId}`}
                    className="text-primary underline"
                  >
                    {labels.activityTitle ?? "(不明)"}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <Item
              label="自社担当者"
              value={withInactive(labels.staffName, labels.staffInactive)}
            />
            <Item
              label="登録者"
              value={formatOptional(detail.createdByName)}
            />
          </dl>
        </section>
      </div>

      <p className="text-xs text-slate-400">
        作成日時: {formatDateTime(detail.createdTime)} / 更新日時:{" "}
        {formatDateTime(detail.lastEditedTime)}
      </p>
    </div>
  );
}
