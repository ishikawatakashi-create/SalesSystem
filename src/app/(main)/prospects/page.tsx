import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import { queryProspectPool } from "@/lib/prospects/read-list";
import { formatDateTime } from "@/features/customers/format";
import { PageHeading } from "@/components/ui/page-heading";
import { EmptyState } from "@/components/ui/state-messages";
import { ProspectLifecycleStatus } from "@/features/prospects/lifecycle-status";
import { canStartProspectPromotion } from "@/lib/prospects/presentation";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

const PROSPECTS_PER_PAGE = 50;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

function positivePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function buildProspectPageHref(params: RawParams, page: number): string {
  const next = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(params)) {
    if (key === "page") continue;
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (value) next.set(key, value);
  }
  if (page > 1) next.set("page", String(page));
  const query = next.toString();
  return `/prospects${query ? `?${query}` : ""}`;
}

export default async function ProspectsPoolPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.view");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const raw = await searchParams;
  const hasFilters = Boolean(
    str(raw, "q") ||
      str(raw, "dnc") === "1" ||
      str(raw, "formalMatch") === "1" ||
      str(raw, "duplicate") === "1",
  );
  const page = positivePage(str(raw, "page"));
  const { items, total } = await queryProspectPool({
    q: str(raw, "q"),
    dncOnly: str(raw, "dnc") === "1",
    formalMatchOnly: str(raw, "formalMatch") === "1",
    duplicateReview: str(raw, "duplicate") === "1",
    page,
    pageSize: PROSPECTS_PER_PAGE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PROSPECTS_PER_PAGE));
  if (total > 0 && page > totalPages) {
    redirect(buildProspectPageHref(raw, totalPages));
  }

  const admin = createAdminClient();
  const ids = items.map((p) => p.id);
  const listCount = new Map<string, number>();
  const contactCount = new Map<string, number>();
  if (ids.length > 0) {
    const { data: mems } = await admin
      .from("prospect_list_memberships")
      .select("prospect_id")
      .in("prospect_id", ids)
      .is("archived_at", null);
    for (const m of mems ?? []) {
      const pid = String(m.prospect_id);
      listCount.set(pid, (listCount.get(pid) ?? 0) + 1);
    }
    const { data: contacts } = await admin
      .from("prospect_contacts")
      .select("prospect_id")
      .in("prospect_id", ids)
      .is("archived_at", null);
    for (const c of contacts ?? []) {
      const pid = String(c.prospect_id);
      contactCount.set(pid, (contactCount.get(pid) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-3">
      <PageHeading
        title="営業候補"
        description="営業リストから集約した候補企業です。正式登録前・登録処理中・正式組織化済みを、行ごとの登録段階で確認できます。"
        meta={`${total}件`}
        supporting={
          <Link
            href="/organizations?relationship=prospect"
            className="font-medium text-slate-700 underline-offset-2 hover:underline"
          >
            正式登録済みの見込顧客を見る →
          </Link>
        }
      />
      <form className="flex flex-wrap gap-2 text-xs" method="get">
        <input
          name="q"
          defaultValue={str(raw, "q") ?? ""}
          placeholder="会社名・所在地・Webドメイン"
          className="rounded border border-slate-200 px-2 py-1"
        />
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            name="dnc"
            value="1"
            defaultChecked={str(raw, "dnc") === "1"}
          />
          営業連絡不要のみ
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            name="duplicate"
            value="1"
            defaultChecked={str(raw, "duplicate") === "1"}
          />
          重複候補
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            name="formalMatch"
            value="1"
            defaultChecked={str(raw, "formalMatch") === "1"}
          />
          既存の正式組織候補あり
        </label>
        <button type="submit" className="rounded border border-slate-300 px-2 py-1">
          条件を適用
        </button>
      </form>
      {items.length === 0 ? (
        <EmptyState
          title={
            hasFilters
              ? "条件に一致する営業候補がありません"
              : "営業候補はまだありません"
          }
          hint={
            hasFilters
              ? "条件を変更するか、絞り込みを解除してください。"
              : "営業リストを作成し、候補企業を追加してください。"
          }
          actionHref={hasFilters ? "/prospects" : "/prospect-lists"}
          actionLabel={hasFilters ? "条件を解除" : "営業リストを開く"}
        />
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">会社名</th>
                <th className="px-2 py-1.5 font-medium">登録段階</th>
                <th className="px-2 py-1.5 font-medium">Webドメイン</th>
                <th className="px-2 py-1.5 font-medium">所在地</th>
                <th className="px-2 py-1.5 font-medium">業種</th>
                <th className="px-2 py-1.5 font-medium">リスト</th>
                <th className="px-2 py-1.5 font-medium">連絡先候補</th>
                <th className="px-2 py-1.5 font-medium">確認事項</th>
                <th className="px-2 py-1.5 font-medium">更新</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/prospects/${p.id}`}
                      className="font-medium text-primary underline"
                    >
                      {p.company_name}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">
                    <ProspectLifecycleStatus
                      promotionStatus={p.promotion_status}
                      promotedPageId={p.promoted_customer_page_id}
                    />
                  </td>
                  <td className="px-2 py-1.5">{p.normalized_domain || "—"}</td>
                  <td className="px-2 py-1.5">
                    {[p.prefecture, p.city].filter(Boolean).join(" ")}
                  </td>
                  <td className="px-2 py-1.5">{p.industry}</td>
                  <td className="px-2 py-1.5">{listCount.get(p.id) ?? 0}</td>
                  <td className="px-2 py-1.5">{contactCount.get(p.id) ?? 0}</td>
                  <td className="px-2 py-1.5">
                    {p.do_not_contact ? (
                      <span className="mr-1 inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
                        <span aria-hidden="true">⊘</span>
                        営業連絡不要
                      </span>
                    ) : null}
                    {p.duplicate_review_status === "probable" ? (
                      <span className="mr-1 inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                        <span aria-hidden="true">!</span>
                        重複候補
                      </span>
                    ) : null}
                    {p.formal_org_match_page_id &&
                    canStartProspectPromotion(p.promotion_status) ? (
                      <Link
                        href={`/organizations/${p.formal_org_match_page_id}`}
                        className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-800 hover:bg-blue-100"
                      >
                        <span aria-hidden="true">↗</span>
                        正式組織の候補あり
                      </Link>
                    ) : !p.do_not_contact &&
                      p.duplicate_review_status !== "probable" ? (
                      <span className="text-slate-400">—</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                    {formatDateTime(p.updated_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > 0 ? (
        <div className="flex items-center gap-3 text-xs text-slate-600">
          <span>
            {(page - 1) * PROSPECTS_PER_PAGE + 1}-
            {Math.min(page * PROSPECTS_PER_PAGE, total)} / {total}件
          </span>
          <nav
            aria-label="営業候補のページ切り替え"
            className="ml-auto flex items-center gap-2"
          >
            {page > 1 ? (
              <Link
                href={buildProspectPageHref(raw, page - 1)}
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
              >
                前へ
              </Link>
            ) : (
              <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">
                前へ
              </span>
            )}
            <span>
              {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={buildProspectPageHref(raw, page + 1)}
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
              >
                次へ
              </Link>
            ) : (
              <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">
                次へ
              </span>
            )}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
