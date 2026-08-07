"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { createActivityAction } from "@/features/activities/actions";
import {
  shouldSubmitOnEnter,
  titleFromActivityBody,
} from "@/lib/activities/quick-title";

export type QuickActivityOption = {
  id: string;
  label: string;
};

export type QuickActivityComposerProps = {
  customerPageId: string;
  /** 案件詳細から渡すと固定 */
  dealPageId?: string | null;
  /** 担当者詳細から渡すと初期選択 */
  contactPageId?: string | null;
  dealOptions?: QuickActivityOption[];
  contactOptions?: QuickActivityOption[];
  categoryOptions?: QuickActivityOption[];
  /** 詳細入力へのベースURL (query はコンポーネントが付与) */
  detailNewHref: string;
};

export function QuickActivityComposer(props: QuickActivityComposerProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [dealId, setDealId] = useState(props.dealPageId ?? "");
  const [contactId, setContactId] = useState(props.contactPageId ?? "");
  const [showExtras, setShowExtras] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const lockedDeal = Boolean(props.dealPageId);
  const lockedContact = Boolean(props.contactPageId);

  const submit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    const title = titleFromActivityBody(trimmed);
    const result = await createActivityAction({
      requestId,
      data: {
        title,
        customerPageId: props.customerPageId,
        dealPageId: (lockedDeal ? props.dealPageId : dealId) || null,
        contactPageIds: (() => {
          const id = lockedContact ? props.contactPageId : contactId;
          return id ? [id] : [];
        })(),
        activityAt: new Date().toISOString(),
        categoryPageIds: categoryId ? [categoryId] : [],
        summary: null,
        nextActionNote: null,
        nextActionDate: null,
        body: trimmed,
        batchId: null,
      },
    });
    if (!result.ok) {
      setError(result.message);
      setSaving(false);
      return;
    }
    setBody("");
    setError(null);
    setRequestId(crypto.randomUUID());
    setSaving(false);
    router.refresh();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [
    body,
    saving,
    requestId,
    props.customerPageId,
    props.dealPageId,
    props.contactPageId,
    lockedDeal,
    lockedContact,
    dealId,
    contactId,
    categoryId,
    router,
  ]);

  const detailHref = (() => {
    const q = new URLSearchParams();
    if (body.trim()) q.set("body", body.trim().slice(0, 2000));
    if (categoryId) q.set("category", categoryId);
    const d = lockedDeal ? props.dealPageId : dealId;
    if (d) q.set("deal", d);
    const c = lockedContact ? props.contactPageId : contactId;
    if (c) q.set("contact", c);
    const qs = q.toString();
    return qs ? `${props.detailNewHref}?${qs}` : props.detailNewHref;
  })();

  return (
    <div className="rounded border border-slate-200 bg-white p-2">
      <label className="sr-only" htmlFor="quick-activity-body">
        対応内容
      </label>
      <textarea
        id="quick-activity-body"
        ref={textareaRef}
        rows={2}
        value={body}
        disabled={saving}
        placeholder="対応内容を入力…"
        className="w-full resize-y rounded border border-slate-300 px-2 py-1.5 text-xs disabled:bg-slate-50"
        onChange={(e) => setBody(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
          onKeyDown={(e) => {
            if (composingRef.current) return;
            if (
              shouldSubmitOnEnter({
                key: e.key,
                shiftKey: e.shiftKey,
                isComposing: Boolean(
                  (e.nativeEvent as KeyboardEvent).isComposing,
                ),
                nativeEvent: e.nativeEvent,
              })
            ) {
              e.preventDefault();
              void submit();
            }
          }}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <button
          type="button"
          className="text-slate-600 underline-offset-2 hover:underline"
          onClick={() => setShowExtras((v) => !v)}
        >
          {showExtras ? "補助項目を隠す" : "分類・案件・担当者"}
        </button>
        <span className="text-slate-400">
          Enterで登録 / Shift+Enterで改行
        </span>
        <a
          href={detailHref}
          className="ml-auto font-medium text-slate-800 underline-offset-2 hover:underline"
        >
          ＋詳細
        </a>
        <button
          type="button"
          disabled={saving || !body.trim()}
          onClick={() => void submit()}
          className="rounded bg-slate-800 px-2 py-1 text-white disabled:opacity-50"
        >
          {saving ? "登録中…" : "登録"}
        </button>
      </div>
      {showExtras && (
        <div className="mt-2 flex flex-wrap gap-2">
          {(props.categoryOptions?.length ?? 0) > 0 && (
            <label className="flex flex-col gap-0.5 text-[11px] text-slate-500">
              分類
              <select
                className="h-7 rounded border border-slate-300 px-1 text-xs"
                value={categoryId}
                disabled={saving}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">（未指定）</option>
                {props.categoryOptions!.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!lockedDeal && (props.dealOptions?.length ?? 0) > 0 && (
            <label className="flex flex-col gap-0.5 text-[11px] text-slate-500">
              案件
              <select
                className="h-7 rounded border border-slate-300 px-1 text-xs"
                value={dealId}
                disabled={saving}
                onChange={(e) => setDealId(e.target.value)}
              >
                <option value="">（未指定）</option>
                {props.dealOptions!.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {lockedDeal && props.dealPageId && (
            <span className="self-end text-[11px] text-slate-500">
              案件: この案件に紐付け
            </span>
          )}
          {!lockedContact && (props.contactOptions?.length ?? 0) > 0 && (
            <label className="flex flex-col gap-0.5 text-[11px] text-slate-500">
              先方担当者
              <select
                className="h-7 rounded border border-slate-300 px-1 text-xs"
                value={contactId}
                disabled={saving}
                onChange={(e) => setContactId(e.target.value)}
              >
                <option value="">（未指定）</option>
                {props.contactOptions!.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {lockedContact && (
            <span className="self-end text-[11px] text-slate-500">
              担当者: この担当者に紐付け
            </span>
          )}
        </div>
      )}
      {error && (
        <p className="mt-1 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
