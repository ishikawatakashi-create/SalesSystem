"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { startProspectPromoteAction } from "@/features/prospects/call-actions";
import {
  ORGANIZATION_RELATIONSHIP_SEEDS,
  type OrganizationRelationshipSemanticKey,
} from "@/lib/organizations/relationship";

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

  function toggleRel(key: OrganizationRelationshipSemanticKey) {
    setRelationships((prev) => {
      if (key === "prospect") return prev.includes("prospect") ? prev : ["prospect", ...prev];
      return prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key];
    });
  }

  function submit() {
    setError(null);
    if (mode === "link_existing" && !existingPageId) {
      setError("紐付ける組織を指定してください");
      return;
    }
    if (mode === "create_new" && high) {
      // allow but require awareness — UI already shows warning
    }
    startTransition(async () => {
      const res = await startProspectPromoteAction({
        prospectId: props.prospectId,
        membershipId: props.membershipId,
        mode,
        existingCustomerPageId:
          mode === "link_existing" ? existingPageId : null,
        relationshipSemanticKeys: relationships,
        contactIds: selectedContacts,
        copyActivityCount,
        createNextAction,
        createDeal,
        dealTitle: createDeal ? dealTitle : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStarted({ jobId: res.jobId, requestId: res.requestId });
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded border border-slate-300 bg-white p-4 text-xs shadow-lg">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold">正式組織へ昇格</h2>
            <p className="text-slate-600">{props.companyName}</p>
          </div>
          <button type="button" onClick={props.onClose} className="underline">
            閉じる
          </button>
        </div>

        {started ? (
          <div className="space-y-2 rounded bg-emerald-50 p-3 text-emerald-900">
            <p className="font-semibold">正式組織化を開始しました</p>
            <p>ジョブが完了すると Prospect 詳細にリンクが表示されます。</p>
            <p className="text-slate-600">request: {started.requestId}</p>
            <button
              type="button"
              className="underline"
              onClick={() => {
                props.onClose();
                router.push(`/prospects/${props.prospectId}`);
              }}
            >
              Prospect詳細へ
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {props.formalMatchPageId ? (
              <div className="rounded bg-blue-50 p-2 text-blue-900">
                既存組織候補があります（信頼度:{" "}
                {props.formalMatchConfidence ?? "probable"}）
                {props.formalMatchConfidence === "high" ? (
                  <p className="mt-1">
                    high confidence のため、新規作成は既定にしません。明示確認してください。
                  </p>
                ) : (
                  <p className="mt-1">
                    社名一致のみの可能性があるため、重複に注意してください。
                  </p>
                )}
              </div>
            ) : null}

            <fieldset className="space-y-1">
              <legend className="font-semibold">方式</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === "link_existing"}
                  onChange={() => setMode("link_existing")}
                  disabled={!props.formalMatchPageId}
                />
                この組織へ紐付け
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === "create_new"}
                  onChange={() => setMode("create_new")}
                />
                別組織として新規作成
              </label>
            </fieldset>

            {mode === "link_existing" ? (
              <label className="block">
                組織 page id
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={existingPageId}
                  onChange={(e) => setExistingPageId(e.target.value)}
                />
              </label>
            ) : (
              <div>
                <div className="font-semibold">関係性（最低 prospect）</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {ORGANIZATION_RELATIONSHIP_SEEDS.map((s) => (
                    <label key={s.semanticKey} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={relationships.includes(s.semanticKey)}
                        disabled={s.semanticKey === "prospect"}
                        onChange={() => toggleRel(s.semanticKey)}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="font-semibold">正式担当者として登録</div>
              {props.contacts.length === 0 ? (
                <p className="text-slate-500">候補なし</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {props.contacts.map((c) => (
                    <li key={c.id}>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedContacts.includes(c.id)}
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
              <div className="font-semibold">
                最近の営業活動を正式履歴として登録
              </div>
              <select
                className="mt-1 rounded border px-2 py-1"
                value={copyActivityCount}
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
                disabled={!props.nextContactAt}
              />
              次回連絡予定を Next Action へ引き継ぐ
              {!props.nextContactAt ? "（予定なし）" : ""}
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={createDeal}
                onChange={(e) => setCreateDeal(e.target.checked)}
              />
              案件も作成
            </label>
            {createDeal ? (
              <input
                className="w-full rounded border px-2 py-1"
                value={dealTitle}
                onChange={(e) => setDealTitle(e.target.value)}
                placeholder="案件名"
              />
            ) : null}

            {error ? (
              <p className="rounded bg-red-50 px-2 py-1 text-red-700">{error}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded border px-3 py-1.5"
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
                昇格を開始
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
