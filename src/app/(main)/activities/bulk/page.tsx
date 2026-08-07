import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { ActivityBulkForm } from "@/features/activities/bulk-form";
import { loadActivityFormOptions } from "@/features/activities/options";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

function strList(params: RawParams, key: string): string[] {
  const v = params[key];
  if (!v) return [];
  const raw = Array.isArray(v) ? v.join(",") : v;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default async function ActivityBulkPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "activity.bulk_create")) {
      redirect("/activities");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const params = await searchParams;
  const initialCustomerIds = strList(params, "customers");
  const options = await loadActivityFormOptions();

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">対応履歴一括登録</h1>
        <Link
          href="/activities"
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          一覧へ戻る
        </Link>
      </div>
      <p className="text-xs text-slate-500">
        同じ内容の対応履歴を複数顧客へ登録します。各顧客ごとに独立して作成されます。
      </p>
      <ActivityBulkForm
        options={options}
        initialCustomerIds={initialCustomerIds}
      />
    </div>
  );
}
