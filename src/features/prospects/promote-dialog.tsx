"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { startProspectPromoteAction } from "@/features/prospects/call-actions";
import {
  ORGANIZATION_RELATIONSHIP_SEEDS,
  type OrganizationRelationshipSemanticKey,
} from "@/lib/organizations/relationship";
import { formalMatchConfidenceLabel } from "@/lib/prospects/presentation";

type Contact = {
  id: string;
  name: string;
  department: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
};

type Props = {
  prospectId: string;
  membershipId: string | null;
  companyName: string;
  formalMatchPageId: string | null;
  formalMatchConfidence: string | null;
  contacts: Contact[];
  nextContactAt: string | null;
  onClose: () => void;
};

export function PromoteDialog(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const high = Boolean(
    props.formalMatchPageId && props.formalMatchConfidence === "high",
  );
  const [mode, setMode] = useState<"link_existing" | "create_new">(() =>
    high ? "link_existing" : "create_new",
  );
  const [existingPageId, setExistingPageId] = useState(
    props.formalMatchPageId ?? "",
  );
  const [relationships, setRelationships] = useState<
    OrganizationRelationshipSemanticKey[]
  >(["prospect"]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>(
    props.contacts.map((c) => c.id),
  );
  const [copyActivityCount, setCopyActivityCount] = useState<0 | 1 | 3>(1);
  const [createNextAction, setCreateNextAction] = useState(
    Boolean(props.nextContactAt),
  );
  const [createDeal, setCreateDeal] = useState(false);
  const [dealTitle, setDealTitle] = useState(`${props.companyName} 案件`);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<{
    jobId: string;
    requestId: string;
  } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);
  const titleId = useId();
  const selectedOrganizationId = existingPageId.trim();
  const targetChanged = Boolean(
    props.formalMatchPageId &&
      selectedOrganizationId !== props.formalMatchPageId,
  );

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    if (started) successRef.current?.focus();
  }, [started]);

  useEffect(() => {
    if (pending && !started) pendingRef.current?.focus();
  }, [pending, started]);

  function toggleRel(key: OrganizationRelationshipSemanticKey) {
    setRelationships((prev) => {
      if (key === "prospect") return prev.includes("prospect") ? prev : ["prospect", ...prev];
      return prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key];
    });
  }

  function submit() {
    if (submittingRef.current || pending) return;
    setError(null);
    if (mode === "link_existing" && !selectedOrganizationId) {
      setError("紐付ける組織を指定してください");
      return;
    }
    submittingRef.current = true;
    if (mode === "create_new" && high) {
      // allow but require awareness — UI already shows warning
    }
    startTransition(async () => {
      try {
        const res = await startProspectPromoteAction({
          prospectId: props.prospectId,
          membershipId: props.membershipId,
          mode,
          existingCustomerPageId:
            mode === "link_existing" ? selectedOrganizationId : null,
          relationshipSemanticKeys: relationships,
          contactIds: selectedContacts,
          copyActivityCount,
          createNextAction,
          createDeal,
          dealTitle: createDeal ? dealTitle : null,
        });
        if (!res.ok) {
          submittingRef.current = false;
          setError(res.error);
          return;
        }
        setStarted({ jobId: res.jobId, requestId: res.requestId });
        router.refresh();
      } catch {
        submittingRef.current = false;
        setError(
          "正式な組織への登録を開始できませんでした。通信状態を確認して、もう一度お試しください。",
        );
      }
    });
  }

  function onDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (!pending) props.onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(
      (element) =>
        !element.hasAttribute("hidden") && element.getClientRects().length > 0,
    );
    if (focusable.length === 0) return;
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={pending}
        onKeyDown={onDialogKeyDown}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded border border-slate-300 bg-white p-4 text-xs shadow-lg"
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 id={titleId} className="text-sm font-bold">
              正式な組織に昇格
            </h2>
            <p className="text-slate-600">{props.companyName}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            disabled={pending}
            onClick={props.onClose}
            className="underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            閉じる
          </button>
        </div>

        {started ? (
          <div
            ref={successRef}
            role="status"
            tabIndex={-1}
            className="space-y-2 rounded bg-emerald-50 p-3 text-emerald-900"
          >
            <p className="font-semibold">正式な組織への登録を開始しました</p>
            <p>
              処理が完了すると、営業候補の詳細に正式な組織へのリンクが表示されます。
            </p>
            <details className="rounded border border-emerald-200 bg-white/60 px-2 py-1 text-slate-700">
              <summary className="cursor-pointer font-medium">処理情報</summary>
              <p className="mt-1 break-all text-[11px]">
                処理受付番号: {started.requestId}
              </p>
            </details>
            <button
              type="button"
              className="underline"
              onClick={() => {
                props.onClose();
                router.push(`/prospects/${props.prospectId}`);
              }}
            >
              営業候補の詳細へ
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {props.formalMatchPageId ? (
              <div className="rounded bg-blue-50 p-2 text-blue-900">
                <p className="font-semibold">既存の正式な組織候補があります</p>
                <p className="mt-0.5">
                  {formalMatchConfidenceLabel(props.formalMatchConfidence)}
                </p>
                {props.formalMatchConfidence === "high" ? (
                  <p className="mt-1">
                    登録内容の一致度が高いため、既存の正式な組織への紐付けを初期選択しています。内容を確認してください。
                  </p>
                ) : (
                  <p className="mt-1">
                    会社名だけが一致している可能性があります。別の組織でないか確認してください。
                  </p>
                )}
              </div>
            ) : null}

            <fieldset className="space-y-1">
              <legend className="font-semibold">登録方法</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="prospect-promotion-mode"
                  checked={mode === "link_existing"}
                  onChange={() => setMode("link_existing")}
                  disabled={pending || !props.formalMatchPageId}
                />
                既存の正式な組織に紐付け
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="prospect-promotion-mode"
                  checked={mode === "create_new"}
                  onChange={() => setMode("create_new")}
                  disabled={pending}
                />
                新しい正式な組織として登録
              </label>
            </fieldset>

            {mode === "link_existing" ? (
              <div className="rounded border border-blue-200 bg-blue-50/60 p-2">
                <p className="font-semibold">
                  {targetChanged
                    ? "変更後の紐付け先"
                    : "自動候補の紐付け先"}
                </p>
                {props.formalMatchPageId ? (
                  <>
                    {selectedOrganizationId ? (
                      <Link
                        href={`/organizations/${encodeURIComponent(selectedOrganizationId)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block font-medium text-primary underline"
                      >
                        選択中の正式な組織を別タブで確認 ↗
                      </Link>
                    ) : (
                      <p className="mt-1 font-medium text-amber-900">
                        紐付け先が未指定です
                      </p>
                    )}
                    {targetChanged ? (
                      <div
                        role="status"
                        className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900"
                      >
                        <p>自動候補とは別の正式な組織を選択しています。</p>
                        <button
                          type="button"
                          disabled={pending}
                          className="mt-1 font-medium underline"
                          onClick={() => {
                            setExistingPageId(props.formalMatchPageId ?? "");
                            setError(null);
                          }}
                        >
                          自動候補に戻す
                        </button>
                      </div>
                    ) : null}
                    <details className="mt-2 border-t border-blue-200 pt-2">
                      <summary className="cursor-pointer font-medium text-slate-700">
                        {targetChanged
                          ? "紐付け先の指定を確認・変更"
                          : "別の正式な組織を指定"}
                      </summary>
                      <p className="mt-1 text-slate-600">
                        自動候補が誤っている場合のみ、管理者から案内された組織識別番号へ変更してください。
                      </p>
                      <label className="mt-2 block font-medium text-slate-700">
                        正式な組織の識別番号
                        <input
                          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono"
                          value={existingPageId}
                          disabled={pending}
                          onChange={(event) => setExistingPageId(event.target.value)}
                          autoComplete="off"
                        />
                      </label>
                    </details>
                  </>
                ) : (
                  <p className="mt-1 text-amber-800">
                    紐付け候補がありません。「新しい正式な組織として登録」を選んでください。
                  </p>
                )}
              </div>
            ) : (
              <div>
                <div className="font-semibold">正式組織での関係性</div>
                <p className="mt-0.5 text-slate-500">
                  「見込顧客」は必ず設定されます。
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {ORGANIZATION_RELATIONSHIP_SEEDS.map((s) => (
                    <label key={s.semanticKey} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={relationships.includes(s.semanticKey)}
                        disabled={pending || s.semanticKey === "prospect"}
                        onChange={() => toggleRel(s.semanticKey)}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="font-semibold">先方担当者として登録</div>
              {props.contacts.length === 0 ? (
                <p className="text-slate-500">
                  登録できる先方担当者候補はありません。
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {props.contacts.map((c) => (
                    <li key={c.id}>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedContacts.includes(c.id)}
                          disabled={pending}
                          onChange={(e) => {
                            setSelectedContacts((prev) =>
                              e.target.checked
                                ? [...prev, c.id]
                                : prev.filter((id) => id !== c.id),
                            );
                          }}
                        />
                        {c.name}
                        {[c.department, c.title, c.email]
                          .filter(Boolean)
                          .join(" / ")
                          ? ` — ${[c.department, c.title, c.email].filter(Boolean).join(" / ")}`
                          : ""}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label
                htmlFor={`${titleId}-activity-count`}
                className="font-semibold"
              >
                最近の営業活動を対応履歴へ引き継ぐ
              </label>
              <select
                id={`${titleId}-activity-count`}
                className="mt-1 rounded border px-2 py-1"
                value={copyActivityCount}
                disabled={pending}
                onChange={(e) =>
                  setCopyActivityCount(Number(e.target.value) as 0 | 1 | 3)
                }
              >
                <option value={1}>直近1件（推奨）</option>
                <option value={3}>直近3件</option>
                <option value={0}>登録しない</option>
              </select>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={createNextAction}
                onChange={(e) => setCreateNextAction(e.target.checked)}
                disabled={pending || !props.nextContactAt}
              />
              次回連絡予定を次回アクションへ引き継ぐ
              {!props.nextContactAt ? "（予定なし）" : ""}
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={createDeal}
                disabled={pending}
                onChange={(e) => setCreateDeal(e.target.checked)}
              />
              案件も作成
            </label>
            {createDeal ? (
              <label className="block" htmlFor={`${titleId}-deal-title`}>
                <span className="font-semibold">案件名</span>
                <input
                  id={`${titleId}-deal-title`}
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={dealTitle}
                  disabled={pending}
                  onChange={(e) => setDealTitle(e.target.value)}
                />
              </label>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="rounded bg-red-50 px-2 py-1 text-red-700"
              >
                {error}
              </p>
            ) : null}

            {pending ? (
              <p
                ref={pendingRef}
                role="status"
                tabIndex={0}
                className="rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-blue-800 outline-none focus:ring-2 focus:ring-blue-600"
              >
                正式な組織への登録を開始しています。完了までお待ちください。
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                className="rounded border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={props.onClose}
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={pending}
                className="rounded bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-50"
                onClick={submit}
              >
                {pending ? "登録処理中…" : "正式な組織への登録を開始"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
