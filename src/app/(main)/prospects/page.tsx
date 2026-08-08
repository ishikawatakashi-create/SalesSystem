import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import { queryProspectPool } from "@/lib/prospects/read-list";
import { CompactEmptyState } from "@/components/ui/compact-empty-state";
import { formatDateTime } from "@/features/customers/format";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
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
  const page = Math.max(Number(str(raw, "page") ?? "1") || 1, 1);
  const { items, total } = await queryProspectPool({
    q: str(raw, "q"),
    dncOnly: str(raw, "dnc") === "1",
    formalMatchOnly: str(raw, "formalMatch") === "1",
    duplicateReview: str(raw, "duplicate") === "1",
    page,
  });

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
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-base font-bold">営業候補（Prospect Pool）</h1>
        <span className="text-xs text-slate-500">{total}件</span>
      </div>
      <form className="flex flex-wrap gap-2 text-xs" method="get">
        <input
          name="q"
          defaultValue={str(raw, "q") ?? ""}
          placeholder="検索"
          className="rounded border border-slate-200 px-2 py-1"
        />
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            name="dnc"
            value="1"
            defaultChecked={str(raw, "dnc") === "1"}
          />
          DNC
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
          正式組織match
        </label>
        <button type="submit" className="rounded border border-slate-300 px-2 py-1">
          適用
        </button>
      </form>
      {items.length === 0 ? (
        <CompactEmptyState message="営業候補はありません。" />
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">会社名</th>
                <th className="px-2 py-1.5 font-medium">domain</th>
                <th className="px-2 py-1.5 font-medium">所在地</th>
                <th className="px-2 py-1.5 font-medium">業種</th>
                <th className="px-2 py-1.5 font-medium">リスト</th>
                <th className="px-2 py-1.5 font-medium">contacts</th>
                <th className="px-2 py-1.5 font-medium">flag</th>
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
                  <td className="px-2 py-1.5">{p.normalized_domain}</td>
                  <td className="px-2 py-1.5">
                    {[p.prefecture, p.city].filter(Boolean).join(" ")}
                  </td>
                  <td className="px-2 py-1.5">{p.industry}</td>
                  <td className="px-2 py-1.5">{listCount.get(p.id) ?? 0}</td>
                  <td className="px-2 py-1.5">{contactCount.get(p.id) ?? 0}</td>
                  <td className="px-2 py-1.5">
                    {p.do_not_contact ? (
                      <span className="text-red-600">DNC</span>
                    ) : null}{" "}
                    {p.formal_org_match_page_id ? (
                      <span className="text-slate-600">既存組織</span>
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
    </div>
  );
}
