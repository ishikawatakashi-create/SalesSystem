"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  assignInquiryAction,
  convertInquiryToActivityAction,
  linkInquiryCustomerAction,
  setInquiryStatusAction,
} from "@/features/inquiries/actions";
import {
  INQUIRY_STATUS_LABELS,
  NO_ACTION_REASON_SUGGESTIONS,
  type CustomerCandidate,
  type InquiryStatus,
} from "@/lib/inquiries/types";

export function InquiryActionsPanel({
  inquiryId,
  status,
  assignedUserId,
  linkedCustomerPageId,
  linkedContactPageId,
  linkedActivityPageId,
  canEdit,
  currentUserId,
  assignees,
  candidates,
}: {
  inquiryId: string;
  status: InquiryStatus;
  assignedUserId: string | null;
  linkedCustomerPageId: string | null;
  linkedContactPageId: string | null;
  linkedActivityPageId: string | null;
  canEdit: boolean;
  currentUserId: string;
  assignees: Array<{ id: string; label: string }>;
  candidates: CustomerCandidate[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [noActionReason, setNoActionReason] = useState("");
  const [showNoAction, setShowNoAction] = useState(false);

  if (!canEdit) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        閲覧専用のため操作できません。
      </div>
    );
  }

  return (
    <div className="space-y-3 text-xs">
      {message && (
        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-700">
          {message}
        </div>
      )}

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold text-slate-800">担当・状態</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded border border-slate-300 px-2 py-1"
            defaultValue={assignedUserId ?? ""}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value || null;
              start(async () => {
                const r = await assignInquiryAction({
                  inquiryId,
                  userId: v,
                });
                setMessage(r.ok ? "担当を更新しました" : r.message);
                router.refresh();
              });
            }}
          >
            <option value="">未割当</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            disabled={pending}
            onClick={() => {
              start(async () => {
                const r = await assignInquiryAction({
                  inquiryId,
                  userId: currentUserId,
                });
                setMessage(r.ok ? "自分を担当にしました" : r.message);
                router.refresh();
              });
            }}
          >
            自分を担当にする
          </button>
          <span className="text-slate-500">
            現在: {INQUIRY_STATUS_LABELS[status]}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              "in_progress",
              "done",
              "new",
            ] as InquiryStatus[]
          ).map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending || status === s}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
              onClick={() => {
                start(async () => {
                  const r = await setInquiryStatusAction({
                    inquiryId,
                    status: s,
                  });
                  setMessage(r.ok ? "状態を更新しました" : r.message);
                  router.refresh();
                });
              }}
            >
              {INQUIRY_STATUS_LABELS[s]}へ
            </button>
          ))}
          <button
            type="button"
            disabled={pending}
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            onClick={() => setShowNoAction(true)}
          >
            対応不要
          </button>
        </div>
        {showNoAction && (
          <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2">
            <p className="mb-1 font-medium text-slate-800">
              対応不要にしますか？
            </p>
            <select
              className="mb-2 w-full rounded border border-slate-300 px-2 py-1"
              value={noActionReason}
              onChange={(e) => setNoActionReason(e.target.value)}
            >
              <option value="">理由（任意）</option>
              {NO_ACTION_REASON_SUGGESTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded bg-slate-800 px-2 py-1 text-white"
                disabled={pending}
                onClick={() => {
                  start(async () => {
                    const r = await setInquiryStatusAction({
                      inquiryId,
                      status: "no_action",
                      noActionReason: noActionReason || null,
                    });
                    setShowNoAction(false);
                    setMessage(r.ok ? "対応不要にしました" : r.message);
                    router.refresh();
                  });
                }}
              >
                対応不要にする
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1"
                onClick={() => setShowNoAction(false)}
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold text-slate-800">既存顧客候補</h2>
        {candidates.length === 0 ? (
          <p className="text-slate-500">強い一致候補はありません。</p>
        ) : (
          <ul className="space-y-1">
            {candidates.map((c) => (
              <li
                key={`${c.customerPageId}-${c.contactPageId}-${c.reason}`}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1"
              >
                <div>
                  <div className="font-medium text-slate-800">
                    {c.displayName}
                  </div>
                  <div className="text-slate-500">
                    {c.reason}
                    {c.strength === "strong" ? " · 強い候補" : " · 参考"}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                  disabled={pending}
                  onClick={() => {
                    start(async () => {
                      const r = await linkInquiryCustomerAction({
                        inquiryId,
                        customerPageId: c.customerPageId,
                        contactPageId: c.contactPageId,
                      });
                      setMessage(r.ok ? "顧客を紐付けました" : r.message);
                      router.refresh();
                    });
                  }}
                >
                  この顧客に紐付け
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href={`/customers/new?fromInquiry=${inquiryId}`}
            className="rounded bg-primary px-2 py-1.5 font-medium text-white hover:bg-primary-hover"
          >
            新規顧客として登録
          </Link>
          {linkedCustomerPageId && (
            <Link
              href={`/customers/${linkedCustomerPageId}`}
              className="rounded border border-slate-300 px-2 py-1.5 hover:bg-slate-50"
            >
              紐付顧客を開く
            </Link>
          )}
          {linkedCustomerPageId && !linkedContactPageId && (
            <Link
              href={`/customers/${linkedCustomerPageId}/contacts/new?fromInquiry=${inquiryId}`}
              className="rounded border border-slate-300 px-2 py-1.5 hover:bg-slate-50"
            >
              先方担当者として登録
            </Link>
          )}
          {linkedContactPageId && (
            <Link
              href={`/contacts/${linkedContactPageId}`}
              className="rounded border border-slate-300 px-2 py-1.5 hover:bg-slate-50"
            >
              紐付担当者を開く
            </Link>
          )}
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold text-slate-800">対応履歴化</h2>
        {linkedActivityPageId ? (
          <p>
            作成済み:{" "}
            <Link
              href={`/activities/${linkedActivityPageId}`}
              className="text-primary underline"
            >
              対応履歴を開く
            </Link>
          </p>
        ) : (
          <button
            type="button"
            disabled={pending || !linkedCustomerPageId}
            className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover disabled:opacity-40"
            onClick={() => {
              start(async () => {
                const r = await convertInquiryToActivityAction({
                  inquiryId,
                  requestId: crypto.randomUUID(),
                });
                setMessage(
                  r.ok
                    ? r.message || "対応履歴を作成しました"
                    : r.message,
                );
                router.refresh();
              });
            }}
          >
            対応履歴として登録
          </button>
        )}
        {!linkedCustomerPageId && (
          <p className="mt-1 text-slate-500">顧客紐付け後に実行できます。</p>
        )}
      </section>

    </div>
  );
}
