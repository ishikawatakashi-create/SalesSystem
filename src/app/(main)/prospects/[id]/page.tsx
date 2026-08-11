import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROSPECT_STAGE_LABELS } from "@/lib/prospects/types";
import { findFormalOrganizationMatches } from "@/lib/prospects/formal-match";
import { ProspectDncForm } from "@/features/prospects/dnc-form";
import { CallHistorySection } from "@/features/prospects/call-history-section";
import { ProspectPromoteButton } from "@/features/prospects/prospect-promote-button";
import { formatDateTime } from "@/features/customers/format";
import { ProspectLifecycleStatus } from "@/features/prospects/lifecycle-status";
import {
  canStartProspectPromotion,
  formalMatchConfidenceLabel,
  formalMatchReasonLabel,
  resolveProspectLifecycle,
} from "@/lib/prospects/presentation";

export const dynamic = "force-dynamic";

export default async function ProspectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "prospect.view");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  const sp = await searchParams;
  const histAt = Array.isArray(sp.histAt) ? sp.histAt[0] : sp.histAt;
  const histId = Array.isArray(sp.histId) ? sp.histId[0] : sp.histId;
  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("prospects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!prospect || prospect.archived_at) {
    redirect("/prospects");
  }

  const { data: contacts } = await admin
    .from("prospect_contacts")
    .select("*")
    .eq("prospect_id", id)
    .is("archived_at", null)
    .order("is_primary", { ascending: false });

  const { data: memberships } = await admin
    .from("prospect_list_memberships")
    .select("*")
    .eq("prospect_id", id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  const listIds = [
    ...new Set((memberships ?? []).map((m) => String(m.prospect_list_id))),
  ];
  const listNames = new Map<string, string>();
  if (listIds.length > 0) {
    const { data: lists } = await admin
      .from("prospect_lists")
      .select("id,name")
      .in("id", listIds);
    for (const l of lists ?? []) {
      listNames.set(String(l.id), String(l.name));
    }
  }

  const assigneeIds = [
    ...new Set(
      (memberships ?? [])
        .map((m) => m.assigned_user_id as string | null)
        .filter(Boolean),
    ),
  ] as string[];
  const assigneeNames = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: users } = await admin
      .from("app_users")
      .select("id,display_name")
      .in("id", assigneeIds);
    for (const u of users ?? []) {
      assigneeNames.set(String(u.id), String(u.display_name));
    }
  }

  const canEdit = hasPermission(user.role, "prospect.edit");
  const canCall = hasPermission(user.role, "prospect.call");
  const canPromote =
    hasPermission(user.role, "prospect.promote") &&
    hasPermission(user.role, "customer.edit") &&
    canStartProspectPromotion(String(prospect.promotion_status));

  const contactEmails = (contacts ?? [])
    .map((c) => c.email as string | null)
    .filter((e): e is string => Boolean(e));
  const liveMatches = await findFormalOrganizationMatches({
    normalizedDomain: (prospect.normalized_domain as string | null) ?? null,
    normalizedPhone: (prospect.normalized_phone as string | null) ?? null,
    contactEmails,
    companyName: String(prospect.company_name),
    prefecture: (prospect.prefecture as string | null) ?? null,
    city: (prospect.city as string | null) ?? null,
  });
  const topMatch = liveMatches[0] ?? null;
  const primaryMembership = (memberships ?? [])[0] ?? null;
  const promotedPageId =
    (prospect.promoted_customer_page_id as string | null) ?? null;
  const promotionAllowsCall = canStartProspectPromotion(
    String(prospect.promotion_status),
  );
  const callStageAllowed = (stage: unknown) =>
    ["new", "assigned", "working"].includes(String(stage));
  const callableMembership = (memberships ?? []).find(
    (membership) =>
      !prospect.do_not_contact &&
      promotionAllowsCall &&
      callStageAllowed(membership.stage) &&
      String(membership.assigned_user_id ?? "") === user.id,
  );
  let callUnavailableReason: string | null = null;
  if (canCall && !callableMembership) {
    if (prospect.do_not_contact) {
      callUnavailableReason =
        "営業連絡不要に設定されているため、架電を開始できません。";
    } else if (!promotionAllowsCall) {
      callUnavailableReason =
        "正式な組織への登録処理中または登録済みのため、営業候補としての架電は開始できません。";
    } else if ((memberships ?? []).some((m) => callStageAllowed(m.stage))) {
      callUnavailableReason = (memberships ?? []).some(
        (m) =>
          callStageAllowed(m.stage) &&
          m.assigned_user_id &&
          String(m.assigned_user_id) !== user.id,
      )
        ? "現在は別の自社担当者に割り当てられています。"
        : "自社担当者が未割当です。所属営業リストで担当者を設定してください。";
    } else if ((memberships ?? []).length > 0) {
      callUnavailableReason =
        "所属営業リストでの対応状況が架電対象外になっています。";
    } else {
      callUnavailableReason =
        "営業リストに所属していないため、架電を開始できません。";
    }
  }
  const lifecycle = resolveProspectLifecycle(
    String(prospect.promotion_status),
    promotedPageId,
  );
  let promotedOrganizationName: string | null = null;
  if (promotedPageId) {
    const { data: promotedOrganization } = await admin
      .from("customer_index")
      .select("display_name")
      .eq("notion_page_id", promotedPageId)
      .maybeSingle();
    promotedOrganizationName = promotedOrganization?.display_name
      ? String(promotedOrganization.display_name)
      : null;
  }

  return (
    <div className="space-y-4 text-xs">
      <div>
        <Link href="/prospects" className="text-slate-500">
          ← 営業候補一覧
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-base font-bold">{String(prospect.company_name)}</h1>
          <ProspectLifecycleStatus
            promotionStatus={String(prospect.promotion_status)}
            promotedPageId={promotedPageId}
            organizationName={promotedOrganizationName}
          />
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          {prospect.do_not_contact ? (
            <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-red-800">
              <span aria-hidden="true">⊘</span>
              営業連絡不要
            </span>
          ) : null}
          {prospect.phone_invalid ? (
            <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-900">
              <span aria-hidden="true">!</span>
              番号要確認
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {canCall && callableMembership ? (
            <Link
              href={`/call-queue/${String(callableMembership.id)}`}
              className="rounded bg-slate-900 px-2 py-1 text-white"
            >
              架電する
            </Link>
          ) : null}
          {canPromote ? (
            <ProspectPromoteButton
              prospectId={id}
              membershipId={
                primaryMembership ? String(primaryMembership.id) : null
              }
              companyName={String(prospect.company_name)}
              formalMatchPageId={
                topMatch?.pageId ??
                (prospect.formal_org_match_page_id as string | null)
              }
              formalMatchConfidence={
                topMatch?.confidence ??
                (prospect.formal_org_match_confidence as string | null)
              }
              contacts={(contacts ?? []).map((c) => ({
                id: String(c.id),
                name: String(c.name),
                department: (c.department as string | null) ?? null,
                title: (c.title as string | null) ?? null,
                phone: (c.phone as string | null) ?? null,
                email: (c.email as string | null) ?? null,
              }))}
              nextContactAt={
                (primaryMembership?.next_contact_at as string | null) ?? null
              }
            />
          ) : null}
        </div>
        {callUnavailableReason ? (
          <p className="mt-2 text-[11px] text-slate-600">
            {callUnavailableReason}
          </p>
        ) : null}
      </div>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold text-slate-800">正式な組織への登録状況</h2>
        {prospect.promotion_status === "completed" &&
        prospect.promoted_customer_page_id ? (
          <div className="flex flex-wrap items-center gap-2">
            <ProspectLifecycleStatus
              promotionStatus={String(prospect.promotion_status)}
              promotedPageId={promotedPageId}
              organizationName={promotedOrganizationName}
            />
            <Link
              href={`/organizations/${String(prospect.promoted_customer_page_id)}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              正式な組織を開く →
            </Link>
          </div>
        ) : lifecycle.kind === "processing" ? (
          <div className="rounded border border-blue-200 bg-blue-50 px-2.5 py-2 text-blue-900">
            <p className="font-medium">正式組織への登録を処理しています</p>
            <p className="mt-0.5 text-[11px]">
              完了すると、この画面から正式な組織を開けるようになります。
            </p>
          </div>
        ) : lifecycle.kind === "completed-link-missing" ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900">
            <p className="font-medium">正式組織化は完了しています</p>
            <p className="mt-0.5 text-[11px]">
              紐付け先の組織リンクを表示できません。管理者に確認してください。
            </p>
          </div>
        ) : topMatch ? (
          <div className="space-y-1">
            <p className="text-slate-700">
              既存の正式な組織と同一の可能性があります。
            </p>
            <Link
              href={`/organizations/${topMatch.pageId}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {topMatch.displayName} を確認 →
            </Link>
            <p className="text-[11px] text-slate-500">
              {formalMatchConfidenceLabel(topMatch.confidence)}・
              {formalMatchReasonLabel(topMatch.reason)}
            </p>
          </div>
        ) : (
          <p className="text-slate-600">
            {canPromote
              ? "まだ正式な組織には登録されていません。必要になったら上部の「正式な組織に昇格」から登録します。"
              : "まだ正式な組織には登録されていません。登録が必要な場合は、昇格権限を持つ担当者に依頼してください。"}
          </p>
        )}
        {lifecycle.kind === "failed" ? (
          <div className="mt-2 rounded border border-red-200 bg-red-50 px-2.5 py-2 text-red-800">
            <p className="font-medium">正式組織への登録に失敗しました</p>
            <p className="mt-0.5 text-[11px]">
              {canPromote
                ? "内容を確認し、上部の「正式な組織に昇格」から再試行してください。"
                : "再試行できる担当者または管理者に確認してください。"}
            </p>
            {prospect.promotion_error ? (
              <details className="mt-1 text-[11px]">
                <summary className="cursor-pointer">
                  管理者向けの技術情報
                </summary>
                <p className="mt-1 break-words text-red-700">
                  {String(prospect.promotion_error)}
                </p>
              </details>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="grid gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-2">
        <Field label="Webサイト" value={prospect.website_url as string | null} />
        <Field label="Webドメイン" value={prospect.normalized_domain as string | null} />
        <Field label="電話" value={prospect.main_phone as string | null} />
        <Field label="業種" value={prospect.industry as string | null} />
        <Field
          label="住所"
          value={[prospect.postal_code, prospect.prefecture, prospect.city, prospect.address]
            .filter(Boolean)
            .join(" ")}
        />
        <Field label="従業員規模" value={prospect.employee_range as string | null} />
        <Field label="メモ" value={prospect.notes as string | null} />
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-800">連絡先担当者の候補</h2>
        {(contacts ?? []).length === 0 ? (
          <p className="text-slate-500">
            {canEdit && canCall && callableMembership
              ? "連絡先担当者の候補はまだありません。架電画面から追加できます。"
              : "連絡先担当者の候補はまだ登録されていません。"}
          </p>
        ) : (
          <ul className="divide-y rounded border border-slate-200 bg-white">
            {(contacts ?? []).map((c) => (
              <li key={String(c.id)} className="px-3 py-2">
                <div className="font-medium">
                  {String(c.name)}
                  {c.is_primary ? (
                    <span className="ml-1 rounded border border-slate-300 bg-slate-50 px-1 py-0.5 text-[10px] text-slate-600">
                      主連絡先
                    </span>
                  ) : null}
                </div>
                <div className="text-slate-600">
                  {[c.department, c.title, c.email, c.phone]
                    .filter(Boolean)
                    .join(" / ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-800">所属営業リスト</h2>
        {(memberships ?? []).length === 0 ? (
          <p className="text-slate-500">所属なし</p>
        ) : (
          <ul className="divide-y rounded border border-slate-200 bg-white">
            {(memberships ?? []).map((m) => {
              const listId = String(m.prospect_list_id);
              const attrs = (m.source_attributes ?? {}) as Record<
                string,
                unknown
              >;
              return (
                <li key={String(m.id)} className="space-y-1 px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/prospect-lists/${listId}`}
                      className="font-medium text-primary underline"
                    >
                      {listNames.get(listId) ?? "リスト"}
                    </Link>
                    <span>
                      {PROSPECT_STAGE_LABELS[
                        m.stage as keyof typeof PROSPECT_STAGE_LABELS
                      ] ?? "状態要確認"}
                    </span>
                    <span className="text-slate-600">
                      {m.assigned_user_id
                        ? assigneeNames.get(String(m.assigned_user_id)) ??
                          "自社担当者あり"
                        : "未割当"}
                    </span>
                    {m.call_count ? (
                      <span className="text-slate-500">
                        架電 {Number(m.call_count)}回
                      </span>
                    ) : null}
                    {m.next_contact_at ? (
                      <span className="text-slate-500">
                        次回 {formatDateTime(String(m.next_contact_at))}
                      </span>
                    ) : null}
                    {m.last_contact_at ? (
                      <span className="text-slate-500">
                        最終 {formatDateTime(String(m.last_contact_at))}
                      </span>
                    ) : null}
                  </div>
                  {Object.keys(attrs).length > 0 ? (
                    <details>
                      <summary className="cursor-pointer text-slate-500">
                        取り込み元の情報
                      </summary>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[10px] text-slate-700">
                        {JSON.stringify(attrs, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CallHistorySection
        prospectId={id}
        cursorCompletedAt={histAt ?? null}
        cursorId={histId ?? null}
      />

      {canEdit ? (
        <ProspectDncForm
          prospectId={id}
          doNotContact={Boolean(prospect.do_not_contact)}
          reason={(prospect.do_not_contact_reason as string | null) ?? ""}
        />
      ) : null}

      <p className="text-slate-400">
        更新: {formatDateTime(String(prospect.updated_at))}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-slate-800">{value || "—"}</div>
    </div>
  );
}
