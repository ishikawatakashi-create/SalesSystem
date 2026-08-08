import Link from "next/link";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import type { DealDetail } from "@/lib/deals/types";
import {
  formatDate,
  formatDateTime,
  formatOptional,
  formatProbability,
  formatYen,
} from "@/features/deals/format";
import type { DetailLabelMaps } from "@/features/deals/list-data";

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

export function DealDetailView({
  detail,
  labels,
  canEdit,
  savedNote,
}: {
  detail: DealDetail;
  labels: DetailLabelMaps;
  canEdit: boolean;
  savedNote?: boolean;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <Breadcrumbs
        items={[
          { label: "案件一覧", href: "/deals" },
          { label: detail.title || "(無題)" },
        ]}
      />
      {savedNote && (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          保存しました。顧客の見込み金額は進行中・保留案件から再集計される場合があります。
        </div>
      )}

      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">{detail.title || "(無題)"}</h1>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {canEdit && (
            <Link
              href={`/deals/${detail.notionPageId}/edit`}
              className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover"
            >
              編集
            </Link>
          )}
          <Link
            href="/deals"
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
            <Item label="案件名" value={detail.title || "(無題)"} />
            <Item
              label="組織"
              value={
                detail.customerPageId ? (
                  <span>
                    <Link
                      href={`/organizations/${detail.customerPageId}`}
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
            <Item label="商材" value={formatOptional(detail.productName)} />
            <Item
              label="事業区分"
              value={withInactive(
                labels.businessCategoryName,
                labels.businessCategoryInactive,
              )}
            />
            <Item
              label="営業ステージ"
              value={withInactive(labels.stageName, labels.stageInactive)}
            />
            <Item
              label="ステータス"
              value={withInactive(labels.statusName, labels.statusInactive)}
            />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">関係者</h2>
          <dl className="divide-y divide-slate-100">
            <Item
              label="顧客担当者"
              value={
                labels.contactNames.length === 0 ? (
                  "—"
                ) : (
                  <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {labels.contactNames.map((c) => (
                      <Link
                        key={c.pageId}
                        href={`/contacts/${c.pageId}`}
                        className="text-primary underline"
                      >
                        {c.name}
                      </Link>
                    ))}
                  </span>
                )
              }
            />
            <Item
              label="自社担当者"
              value={
                labels.staffNames.length === 0 ? (
                  "—"
                ) : (
                  <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {labels.staffNames.map((s) => (
                      <span key={s.pageId}>
                        {s.name}
                        {s.inactive && (
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
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">
            金額・確度・日程
          </h2>
          <dl className="divide-y divide-slate-100">
            <Item
              label="見込み金額"
              value={formatYen(detail.expectedAmount)}
            />
            <Item
              label="契約金額"
              value={formatYen(detail.contractAmount)}
            />
            <Item
              label="確度"
              value={formatProbability(detail.probability)}
            />
            <Item
              label="見込みクローズ日"
              value={formatDate(detail.expectedCloseDate)}
            />
            <Item label="受注日" value={formatDate(detail.contractedAt)} />
            <Item
              label="契約期間"
              value={
                detail.periodStart || detail.periodEnd
                  ? `${formatDate(detail.periodStart)} 〜 ${formatDate(detail.periodEnd)}`
                  : "—"
              }
            />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">失注理由・備考</h2>
          <dl className="divide-y divide-slate-100">
            <Item
              label="失注理由"
              value={
                <span className="whitespace-pre-wrap">
                  {detail.lostReason?.trim() ? detail.lostReason : "—"}
                </span>
              }
            />
            <Item
              label="備考"
              value={
                <span className="whitespace-pre-wrap">
                  {detail.note?.trim() ? detail.note : "—"}
                </span>
              }
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
