import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { countMyCallQueue } from "@/lib/prospects/call-queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { ClaimStartButton } from "@/features/prospects/claim-start-button";

export const dynamic = "force-dynamic";

export default async function CallQueuePage({
  searchParams,
}: {
  searchParams: Promise<{
    list?: string;
    filter?: string;
    empty?: string;
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
  const filter = sp.filter || "eligible";
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
      <div>
        <h1 className="text-base font-bold">架電キュー</h1>
        <p className="text-slate-600">
          自分の担当 Prospect を期限優先で順に架電します。自動発信はしません。
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="再架電期限超過" value={counts.overdue} />
        <Stat label="本日再架電" value={counts.today} />
        <Stat label="未着手担当" value={counts.unstarted} />
      </div>

      {sp.empty === "1" ? (
        <p className="rounded bg-slate-100 px-3 py-2 text-slate-700">
          キューに次の対象がありません。
        </p>
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
          フィルタ
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
          条件更新
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
