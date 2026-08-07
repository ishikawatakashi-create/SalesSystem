import Link from "next/link";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import type { ContractDetail } from "@/lib/contracts/types";
import {
  formatDate,
  formatDateTime,
  formatOptional,
  formatPeriod,
  formatYen,
} from "@/features/contracts/format";
import type { DetailLabelMaps } from "@/features/contracts/list-data";

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

export function ContractDetailView({
  detail,
  labels,
  canEdit,
  savedNote,
}: {
  detail: ContractDetail;
  labels: DetailLabelMaps;
  canEdit: boolean;
  savedNote?: boolean;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <Breadcrumbs
        items={[
          { label: "契約一覧", href: "/contracts" },
          { label: detail.title || "(無題)" },
        ]}
      />
      {savedNote && (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          保存しました。
        </div>
      )}

      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">{detail.title || "(無題)"}</h1>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {canEdit && (
            <Link
              href={`/contracts/${detail.notionPageId}/edit`}
              className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover"
            >
              編集
            </Link>
          )}
          <Link
            href="/contracts"
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
            <Item label="契約名" value={detail.title || "(無題)"} />
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
              label="契約区分"
              value={withInactive(
                labels.contractTypeName,
                labels.contractTypeInactive,
              )}
            />
            <Item
              label="取引区分"
              value={withInactive(
                labels.tradeTypeName,
                labels.tradeTypeInactive,
              )}
            />
            <Item
              label="状態"
              value={withInactive(labels.statusName, labels.statusInactive)}
            />
            <Item
              label="支払状況"
              value={withInactive(
                labels.paymentStatusName,
                labels.paymentStatusInactive,
              )}
            />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">金額・日程</h2>
          <dl className="divide-y divide-slate-100">
            <Item label="金額" value={formatYen(detail.amount)} />
            <Item label="契約日" value={formatDate(detail.contractedAt)} />
            <Item
              label="期間"
              value={formatPeriod(detail.startDate, detail.endDate)}
            />
            <Item
              label="自動更新"
              value={detail.autoRenew ? "する" : "しない"}
            />
            <Item
              label="担当者"
              value={
                labels.staffNames.length === 0 ? (
                  "—"
                ) : (
                  <span className="flex flex-wrap gap-x-2">
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

        <section className="rounded border border-slate-200 bg-white p-3 lg:col-span-2">
          <h2 className="mb-1 text-xs font-bold text-slate-700">契約書・備考</h2>
          <dl className="divide-y divide-slate-100">
            <Item
              label="契約書URL"
              value={
                detail.contractUrl ? (
                  <a
                    href={detail.contractUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary underline"
                  >
                    {detail.contractUrl}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Item
              label="契約書ファイル"
              value={
                detail.hasContractFile && detail.contractFiles.length > 0 ? (
                  <ul className="space-y-0.5">
                    {detail.contractFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`}>
                        {f.url ? (
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-primary underline"
                          >
                            {f.name || "ファイル"}
                          </a>
                        ) : (
                          f.name || "ファイル"
                        )}
                      </li>
                    ))}
                  </ul>
                ) : detail.hasContractFile ? (
                  "あり(メタデータ取得不可)"
                ) : (
                  "—"
                )
              }
            />
            <Item
              label="請求条件"
              value={formatOptional(detail.billingTerms)}
            />
            <Item label="備考" value={formatOptional(detail.note)} />
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
