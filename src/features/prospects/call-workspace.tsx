"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  CALL_RESULT_LABELS,
  CALL_RESULT_SHORTCUTS,
  PRIMARY_CALL_RESULTS,
  SECONDARY_CALL_RESULTS,
  getCallResultSideEffects,
  type CallResult,
} from "@/lib/prospects/call-results";
import {
  addProspectContactInlineAction,
  newCallRequestIdAction,
  saveCallAttemptAction,
} from "@/features/prospects/call-actions";
import { PromoteDialog } from "@/features/prospects/promote-dialog";
import { ProspectLifecycleStatus } from "@/features/prospects/lifecycle-status";
import {
  formalMatchConfidenceLabel,
  resolveProspectLifecycle,
} from "@/lib/prospects/presentation";
import { normalizeCallQueueFilter } from "@/lib/prospects/call-filter";

type Props = {
  membershipId: string;
  prospectId: string;
  listId: string;
  listName: string;
  companyName: string;
  stage: string;
  stageLabel: string;
  assigneeName: string | null;
  websiteUrl: string | null;
  mainPhone: string | null;
  phoneInvalid: boolean;
  address: string;
  industry: string | null;
  doNotContact: boolean;
  promotionStatus: string;
  promotedPageId: string | null;
  formalMatch: {
    pageId: string;
    confidence: string;
  } | null;
  contacts: Array<{
    id: string;
    name: string;
    department: string | null;
    title: string | null;
    phone: string | null;
    email: string | null;
    isPrimary: boolean;
  }>;
  recentAttempts: Array<{
    id: string;
    result: string;
    note: string | null;
    completedAt: string;
  }>;
  nextContactAt: string | null;
  claimConflict: string | null;
  filter: string;
  canPromote: boolean;
};

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  // display as JST-ish local for input[type=datetime-local]
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  // treat as Asia/Tokyo
  const iso = new Date(`${local}:00+09:00`).toISOString();
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function CallWorkspace(props: Props) {
  const router = useRouter();
  const filter = normalizeCallQueueFilter(props.filter);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CallResult | "">("");
  const [note, setNote] = useState("");
  const [nextLocal, setNextLocal] = useState(
    toLocalInputValue(props.nextContactAt),
  );
  const [clearNext, setClearNext] = useState(false);
  const [contactId, setContactId] = useState(
    props.contacts.find((c) => c.isPrimary)?.id ??
      props.contacts[0]?.id ??
      "",
  );
  const [phoneUsed, setPhoneUsed] = useState(props.mainPhone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [showSecondary, setShowSecondary] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [callClosed, setCallClosed] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const locking = useRef(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const formId = useId();

  useEffect(() => {
    void newCallRequestIdAction().then(setRequestId);
  }, [props.membershipId]);

  const effects = result ? getCallResultSideEffects(result) : null;
  const lifecycle = resolveProspectLifecycle(
    props.promotionStatus,
    props.promotedPageId,
  );
  const selectedPhoneIsMarkedInvalid = Boolean(
    props.phoneInvalid && props.mainPhone && phoneUsed === props.mainPhone,
  );

  async function submit(saveAndNext: boolean) {
    if (locking.current || pending) return;
    if (callClosed) {
      setError("この企業は現在の架電対象から外れています。");
      return;
    }
    if (props.claimConflict) {
      setError(
        `${props.claimConflict}さんが対応中のため、架電結果を保存できません。`,
      );
      return;
    }
    if (!result) {
      setError("架電結果を選択してください");
      return;
    }
    if (!requestId) {
      setError("準備中です。少し待って再試行してください");
      return;
    }
    if (effects?.requireNextContact && !nextLocal && !clearNext) {
      setError("折返し希望は次回連絡日時が必須です");
      return;
    }
    locking.current = true;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const res = await saveCallAttemptAction({
          requestId,
          prospectId: props.prospectId,
          membershipId: props.membershipId,
          contactId: contactId || null,
          result,
          note,
          nextContactAt: clearNext ? null : localInputToIso(nextLocal),
          clearNextContact: clearNext,
          phoneUsed: phoneUsed || null,
          saveAndNext,
          listId: props.listId,
          filter,
        });
        if (!res.ok) {
          setError(res.error);
          locking.current = false;
          return;
        }
        if (saveAndNext) {
          if (res.nextMembershipId) {
            const query = new URLSearchParams({
              list: props.listId,
              filter,
            });
            router.replace(
              `/call-queue/${res.nextMembershipId}?${query.toString()}`,
            );
            return;
          }
          const query = new URLSearchParams({
            empty: "1",
            list: props.listId,
            filter,
          });
          router.replace(`/call-queue?${query.toString()}`);
          return;
        }
        if (res.promoteCtaStrong) {
          setShowPromote(true);
        }
        const nextId = await newCallRequestIdAction();
        setRequestId(nextId);
        setResult("");
        setNote("");
        setShowSecondary(false);
        const remainsCallable =
          effects?.membershipStage !== "qualified" &&
          effects?.membershipStage !== "disqualified" &&
          !effects?.setDoNotContact;
        setCallClosed(!remainsCallable);
        setSuccess(
          remainsCallable
            ? "架電結果を保存しました"
            : "架電結果を保存し、この企業を現在の架電対象から外しました",
        );
        locking.current = false;
        if (remainsCallable) router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存に失敗しました");
        locking.current = false;
      }
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const composing = (e as KeyboardEvent & { isComposing?: boolean })
        .isComposing;
      if (composing) return;
      if (showPromote || showAddContact || callClosed) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void submit(true);
        return;
      }

      if (
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const mapped = CALL_RESULT_SHORTCUTS[e.key];
      if (mapped) {
        e.preventDefault();
        setResult(mapped);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function copyPhone() {
    if (!phoneUsed) return;
    setError(null);
    setSuccess(null);
    try {
      await navigator.clipboard.writeText(phoneUsed);
      setSuccess("電話番号をコピーしました");
    } catch {
      setError("電話番号をコピーできませんでした。番号を選択してコピーしてください。");
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1.1fr_1fr]">
      <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
        {props.claimConflict ? (
          <p className="rounded bg-amber-50 px-2 py-1 text-amber-900">
            {props.claimConflict}さんが対応中
          </p>
        ) : null}
        <div>
          <div className="text-[11px] text-slate-500">{props.listName}</div>
          <h1 className="text-lg font-bold text-slate-900">
            {props.companyName}
          </h1>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
            <ProspectLifecycleStatus
              promotionStatus={props.promotionStatus}
              promotedPageId={props.promotedPageId}
            />
            <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5">
              対応状況：{props.stageLabel}
            </span>
            {props.assigneeName ? (
              <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5">
                自社担当者：{props.assigneeName}
              </span>
            ) : null}
            {props.doNotContact ? (
              <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-red-800">
                <span aria-hidden="true">⊘</span>
                営業連絡不要
              </span>
            ) : null}
            {props.phoneInvalid ? (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                番号要確認
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="架電に使う電話番号"
            className="rounded border border-slate-300 px-2 py-1"
            value={phoneUsed}
            onChange={(e) => setPhoneUsed(e.target.value)}
          >
            {props.mainPhone ? (
              <option value={props.mainPhone}>代表電話: {props.mainPhone}</option>
            ) : (
              <option value="">電話番号なし</option>
            )}
            {props.contacts
              .filter((c) => c.phone)
              .map((c) => (
                <option key={c.id} value={c.phone ?? ""}>
                  {c.name}: {c.phone}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={!phoneUsed}
            onClick={() => void copyPhone()}
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            コピー
          </button>
          {phoneUsed && !selectedPhoneIsMarkedInvalid ? (
            <a
              href={`tel:${phoneUsed.replace(/[^\d+]/g, "")}`}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            >
              電話アプリで開く
            </a>
          ) : null}
          {selectedPhoneIsMarkedInvalid ? (
            <span className="text-[11px] text-amber-800">
              この番号は要確認のため、電話アプリでは開けません
            </span>
          ) : null}
        </div>

        <div>
          <div className="mb-1 font-semibold text-slate-700">連絡先担当者</div>
          {props.contacts.length === 0 ? (
            <p className="text-slate-500">連絡先担当者の候補はありません</p>
          ) : (
            <select
              className="w-full rounded border border-slate-300 px-2 py-1"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
            >
              {props.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {[c.department, c.title].filter(Boolean).length
                    ? ` / ${[c.department, c.title].filter(Boolean).join(" / ")}`
                    : ""}
                </option>
              ))}
            </select>
          )}
          {contactId ? (
            <div className="mt-1 text-slate-600">
              {(() => {
                const c = props.contacts.find((x) => x.id === contactId);
                if (!c) return null;
                return [c.phone, c.email].filter(Boolean).join(" / ");
              })()}
            </div>
          ) : null}
          <button
            type="button"
            className="mt-1 text-slate-600 underline"
            onClick={() => setShowAddContact((v) => !v)}
          >
            連絡先担当者を追加
          </button>
          {showAddContact ? (
            <div className="mt-2 flex gap-2">
              <input
                className="flex-1 rounded border border-slate-300 px-2 py-1"
                placeholder="氏名"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
              />
              <button
                type="button"
                className="rounded bg-slate-800 px-2 py-1 text-white"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const res = await addProspectContactInlineAction({
                      prospectId: props.prospectId,
                      name: newContactName,
                    });
                    if (res.ok) {
                      setContactId(res.contactId);
                      setNewContactName("");
                      setShowAddContact(false);
                      setSuccess("連絡先担当者を追加しました");
                      router.refresh();
                    } else setError(res.error);
                  });
                }}
              >
                連絡先担当者を追加
              </button>
            </div>
          ) : null}
        </div>

        <div className="grid gap-1 text-slate-700">
          {props.websiteUrl ? (
            <a
              href={props.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Webサイト ↗
            </a>
          ) : null}
          {props.address ? <div>所在地: {props.address}</div> : null}
          {props.industry ? <div>業種: {props.industry}</div> : null}
          {lifecycle.kind === "completed" && props.promotedPageId ? (
            <div className="text-emerald-800">
              正式な組織に登録済み：{" "}
              <Link
                href={`/organizations/${props.promotedPageId}`}
                className="font-medium underline"
              >
                正式な組織を開く
              </Link>
            </div>
          ) : lifecycle.kind === "completed-link-missing" ? (
            <div className="text-amber-800">
              正式組織化済みですが、組織リンクを表示できません。管理者に確認してください。
            </div>
          ) : lifecycle.kind === "processing" ? (
            <div className="text-blue-800">
              正式な組織への登録を処理しています。
            </div>
          ) : props.formalMatch ? (
            <div>
              既存の正式な組織候補（
              {formalMatchConfidenceLabel(props.formalMatch.confidence)}）:{" "}
              <Link
                href={`/organizations/${props.formalMatch.pageId}`}
                className="underline"
              >
                正式な組織を確認
              </Link>
            </div>
          ) : (
            <div className="text-slate-500">
              正式な組織にはまだ登録されていません
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 font-semibold">過去履歴</div>
          {props.recentAttempts.length === 0 ? (
            <p className="text-slate-500">過去の架電履歴はありません</p>
          ) : (
            <ul className="space-y-1 text-slate-700">
              {props.recentAttempts.map((a) => (
                <li key={a.id}>
                  {new Date(a.completedAt).toLocaleString("ja-JP", {
                    timeZone: "Asia/Tokyo",
                    month: "numeric",
                    day: "numeric",
                  })}{" "}
                  {CALL_RESULT_LABELS[a.result as CallResult] ?? "結果要確認"}
                  {a.note ? ` — ${a.note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">架電結果</h2>
        <p className="text-[11px] text-slate-500">
          数字キー 1不通 2担当不在 3接触 4資料送付（記録のみ） 5興味あり 6アポ 7興味なし /
          Ctrl/Cmd+Enter で保存して次へ
        </p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" id={formId}>
          {PRIMARY_CALL_RESULTS.map((r) => (
            <button
              key={r}
              type="button"
              disabled={pending || callClosed || Boolean(props.claimConflict)}
              onClick={() => setResult(r)}
              className={
                result === r
                  ? "rounded border border-slate-800 bg-slate-800 px-2 py-2 text-left text-white disabled:cursor-not-allowed disabled:opacity-50"
                  : "rounded border border-slate-300 px-2 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              {r === "send_materials"
                ? "資料送付（記録のみ）"
                : CALL_RESULT_LABELS[r]}
            </button>
          ))}
        </div>
        {result === "send_materials" ? (
          <p className="text-[11px] text-amber-800">
            ※メールは自動送信されません。資料送付はご自身で行い、結果だけ記録します。
          </p>
        ) : null}
        <button
          type="button"
          disabled={pending || callClosed || Boolean(props.claimConflict)}
          className="text-slate-600 underline disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => setShowSecondary((v) => !v)}
        >
          {showSecondary ? "その他を隠す" : "その他の結果"}
        </button>
        {showSecondary ? (
          <div className="grid grid-cols-2 gap-1.5">
            {SECONDARY_CALL_RESULTS.map((r) => (
              <button
                key={r}
                type="button"
                disabled={pending || callClosed || Boolean(props.claimConflict)}
                onClick={() => setResult(r)}
                className={
                  result === r
                    ? "rounded border border-slate-800 bg-slate-800 px-2 py-2 text-left text-white disabled:cursor-not-allowed disabled:opacity-50"
                    : "rounded border border-slate-300 px-2 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                }
              >
                {CALL_RESULT_LABELS[r]}
              </button>
            ))}
          </div>
        ) : null}

        <label className="block">
          <span className="font-semibold">メモ</span>
          <textarea
            ref={noteRef}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
            rows={4}
            value={note}
            disabled={pending || callClosed || Boolean(props.claimConflict)}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="font-semibold">
            次回連絡
            {effects?.requireNextContact ? "（必須）" : ""}
            {effects?.recommendNextContact && !effects.requireNextContact
              ? "（推奨）"
              : ""}
          </span>
          <input
            type="datetime-local"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
            value={nextLocal}
            disabled={
              clearNext || pending || callClosed || Boolean(props.claimConflict)
            }
            onChange={(e) => setNextLocal(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-slate-700">
          <input
            type="checkbox"
            checked={clearNext}
            disabled={pending || callClosed || Boolean(props.claimConflict)}
            onChange={(e) => setClearNext(e.target.checked)}
          />
          予定をクリア
        </label>

        {error ? (
          <p className="rounded bg-red-50 px-2 py-1 text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p
            role="status"
            aria-live="polite"
            className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800"
          >
            {success}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={
              pending || callClosed || Boolean(props.claimConflict)
            }
            onClick={() => void submit(false)}
            className="rounded border border-slate-400 px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
          >
            {pending ? "保存中…" : "架電結果を保存"}
          </button>
          <button
            type="button"
            disabled={
              pending || callClosed || Boolean(props.claimConflict)
            }
            onClick={() => void submit(true)}
            className="rounded bg-slate-900 px-3 py-2 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "保存中…" : "架電結果を保存して次へ →"}
          </button>
          {props.canPromote ? (
            <button
              type="button"
              className="rounded border border-emerald-600 px-3 py-2 text-emerald-800 hover:bg-emerald-50"
              onClick={() => setShowPromote(true)}
            >
              正式な組織に昇格
            </button>
          ) : null}
        </div>
        <Link
          href={`/prospects/${props.prospectId}`}
          className="inline-block text-slate-600 underline"
        >
          営業候補の詳細
        </Link>
      </section>

      {showPromote && props.canPromote ? (
        <PromoteDialog
          prospectId={props.prospectId}
          membershipId={props.membershipId}
          companyName={props.companyName}
          formalMatchPageId={props.formalMatch?.pageId ?? null}
          formalMatchConfidence={props.formalMatch?.confidence ?? null}
          contacts={props.contacts}
          nextContactAt={props.nextContactAt}
          onClose={() => setShowPromote(false)}
        />
      ) : null}
    </div>
  );
}
