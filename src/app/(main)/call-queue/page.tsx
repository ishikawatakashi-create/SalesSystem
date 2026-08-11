import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { countMyCallQueue } from "@/lib/prospects/call-queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { ClaimStartButton } from "@/features/prospects/claim-start-button";
import { PageHeading } from "@/components/ui/page-heading";
import { ProspectLifecycleStatus } from "@/features/prospects/lifecycle-status";
import { normalizeCallQueueFilter } from "@/lib/prospects/call-filter";

export const dynamic = "force-dynamic";

export default async function CallQueuePage({
  searchParams,
}: {
  searchParams: Promise<{
    list?: string;
    filter?: string;
    empty?: string;
    unavailable?: string;
  }>;
}) {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "prospect.call");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const sp = await searchParams;
  const listId = sp.list || null;
  const filter = normalizeCallQueueFilter(sp.filter);
  const counts = await countMyCallQueue({ userId: user.id });

  const admin = createAdminClient();
  const { data: lists } = await admin
    .from("prospect_lists")
    .select("id,name")
    .is("archived_at", null)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(50);

  return (
    <div className="mx-auto max-w-3xl space-y-4 text-xs">
      <PageHeading
        title="架電キュー"
        description="自分に割り当てられた営業候補を、期限の近い順に確認して架電します。電話は自動発信されません。"
        status={
          <ProspectLifecycleStatus
            promotionStatus="none"
            promotedPageId={null}
          />
        }
        supporting="条件を選んで「架電を開始」を押すと、次に連絡する企業を1件ずつ表示します。"
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label="再架電期限超過" value={counts.overdue} />
        <Stat label="本日再架電" value={counts.today} />
        <Stat label="未着手（自分の担当）" value={counts.unstarted} />
      </div>

      {sp.empty === "1" ? (
        <div className="rounded border border-slate-200 bg-slate-100 px-3 py-2 text-slate-700">
          <p className="font-medium">条件に合う次の架電対象はありません</p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            営業リストで自社担当者や次回連絡予定を確認するか、条件を変更してください。
          </p>
          <Link
            href="/prospect-lists"
            className="mt-1 inline-block font-medium text-slate-800 underline-offset-2 hover:underline"
          >
            営業リストを確認 →
          </Link>
        </div>
      ) : null}

      {sp.unavailable === "1" ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
          <p className="font-medium">この架電対象は現在開けません</p>
          <p className="mt-0.5 text-[11px] text-amber-800">
            担当変更、営業連絡不要、進捗更新、またはアーカイブにより対象外になった可能性があります。最新の条件で架電を開始してください。
          </p>
        </div>
      ) : null}

      <form
        method="get"
        className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-3"
      >
        <label className="block">
          営業リスト
          <select
            name="list"
            defaultValue={listId ?? ""}
            className="mt-1 block rounded border px-2 py-1"
          >
            <option value="">すべて</option>
            {(lists ?? []).map((l) => (
              <option key={String(l.id)} value={String(l.id)}>
                {String(l.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          架電対象
          <select
            name="filter"
            defaultValue={filter}
            className="mt-1 block rounded border px-2 py-1"
          >
            <option value="eligible">対象（期限到来/予定なし）</option>
            <option value="overdue">期限超過</option>
            <option value="today">本日</option>
            <option value="no_schedule">予定なし</option>
            <option value="all">すべて（未来予定含む）</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded border border-slate-400 px-3 py-1.5 hover:bg-slate-50"
        >
          条件を更新
        </button>
      </form>

      <ClaimStartButton listId={listId} filter={filter} />

      <div className="flex gap-3 text-slate-600">
        <Link href="/prospect-lists" className="underline">
          営業リストへ
        </Link>
        {hasPermission(user.role, "prospect.view") ? (
          <Link href="/prospects" className="underline">
            営業候補検索
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-slate-500">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
