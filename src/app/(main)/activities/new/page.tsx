import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { ActivityForm } from "@/features/activities/activity-form";
import { loadActivityFormOptions } from "@/features/activities/options";

export const dynamic = "force-dynamic";

export default async function ActivityNewPage() {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "activity.edit")) {
      redirect("/activities");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const options = await loadActivityFormOptions();

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">対応履歴登録</h1>
        <Link
          href="/activities"
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          一覧へ戻る
        </Link>
      </div>
      <ActivityForm meta={{ mode: "create" }} options={options} />
    </div>
  );
}
