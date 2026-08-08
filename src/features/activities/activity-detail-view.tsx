import Link from "next/link";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import type { ActivityDetail } from "@/lib/activities/types";
import {
  formatDate,
  formatDateTime,
  formatOptional,
} from "@/features/activities/format";
import type { DetailLabelMaps } from "@/features/activities/list-data";

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1">
      <dt className="w-32 shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="text-xs text-slate-900">{value ?? "—"}</dd>
    </div>
  );
}

export function ActivityDetailView({
  detail,
  labels,
  canEdit,
  savedNote,
}: {
  detail: ActivityDetail;
  labels: DetailLabelMaps;
  canEdit: boolean;
  savedNote?: boolean;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <Breadcrumbs
        items={[
          { label: "対応履歴一覧", href: "/activities" },
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
              href={`/activities/${detail.notionPageId}/edit`}
              className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover"
            >
              編集
            </Link>
          )}
          <Link
            href="/activities"
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
              label="対応日時"
              value={formatDateTime(detail.activityAt)}
            />
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
              label="対応分類"
              value={
                labels.categoryNames.length === 0 ? (
                  "—"
                ) : (
                  <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {labels.categoryNames.map((c) => (
                      <span key={c.pageId}>
                        {c.name}
                        {c.inactive && (
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
              label="登録者"
              value={formatOptional(detail.createdByName)}
            />
            <Item
              label="最終編集者"
              value={formatOptional(detail.updatedByName)}
            />
          </dl>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">要約</h2>
          <p className="whitespace-pre-wrap text-xs">
            {detail.summary?.trim() ? detail.summary : "—"}
          </p>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-1 text-xs font-bold text-slate-700">
            次回アクション(入力記録)
          </h2>
          <dl className="divide-y divide-slate-100">
            <Item
              label="内容"
              value={formatOptional(detail.nextActionNote)}
            />
            <Item
              label="予定日"
              value={formatDate(detail.nextActionDate)}
            />
          </dl>
          <p className="mt-1 text-[10px] text-slate-400">
            入力記録のスナップショットです。正本は次回アクション一覧を参照してください。
          </p>
        </section>

        <section className="rounded border border-slate-200 bg-white p-3 lg:col-span-2">
          <h2 className="mb-1 text-xs font-bold text-slate-700">本文</h2>
          <p className="whitespace-pre-wrap text-xs text-slate-900">
            {detail.body?.trim() ? detail.body : "—"}
          </p>
        </section>
      </div>

      <p className="text-xs text-slate-400">
        作成日時: {formatDateTime(detail.createdTime)} / 更新日時:{" "}
        {formatDateTime(detail.lastEditedTime)}
      </p>
    </div>
  );
}
