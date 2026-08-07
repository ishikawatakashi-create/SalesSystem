import Link from "next/link";

import type { ComplaintDetail } from "@/lib/complaints/types";
import {
  formatDate,
  formatDateTime,
  formatOptional,
} from "@/features/complaints/format";
import type { DetailLabelMaps } from "@/features/complaints/list-data";

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1">
      <dt className="w-32 shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="text-xs text-slate-900 whitespace-pre-wrap">
        {value ?? "—"}
      </dd>
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

export function ComplaintDetailView({
  detail,
  labels,
  canEdit,
  savedNote,
}: {
  detail: ComplaintDetail;
  labels: DetailLabelMaps;
  canEdit: boolean;
  savedNote?: boolean;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      {savedNote && (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          保存しました。
        </div>
      )}

      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">{detail.title || "(無題)"}</h1>
        <span className="text-xs text-slate-600">
          {withInactive(labels.severityName, labels.severityInactive)}
        </span>
        <span className="text-xs text-slate-600">
          {withInactive(labels.statusName, labels.statusInactive)}
        </span>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {canEdit && (
            <Link
              href={`/complaints/${detail.notionPageId}/edit`}
              className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover"
            >
              編集
            </Link>
          )}
          <Link
            href="/complaints"
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
            <Item label="タイトル" value={detail.title || "(無題)"} />
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
                    {labels.dealTitle ?? "(無題)"}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <Item
              label="重要度"
              value={withInactive(
                labels.severityName,
                labels.severityInactive,
              )}
            />
            <Item
              label="対応状況"
              value={withInactive(labels.statusName, labels.statusInactive)}
            />
            <Item
              label="対応責任者"
              value={withInactive(labels.staffName, labels.staffInactive)}
            />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">日程</h2>
          <dl className="divide-y divide-slate-100">
            <Item label="発生日" value={formatDate(detail.occurredOn)} />
            <Item label="対応期限" value={formatDate(detail.dueDate)} />
            <Item label="完了日" value={formatDate(detail.completedOn)} />
            <Item label="概要" value={formatOptional(detail.summary)} />
            <Item label="備考" value={formatOptional(detail.note)} />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3 lg:col-span-2">
          <h2 className="mb-1 text-xs font-bold text-slate-700">詳細本文</h2>
          <dl className="divide-y divide-slate-100">
            <Item label="内容" value={formatOptional(detail.content)} />
            <Item label="原因" value={formatOptional(detail.cause)} />
            <Item label="対応" value={formatOptional(detail.response)} />
            <Item
              label="再発防止"
              value={formatOptional(detail.prevention)}
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
