import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { ActionForm } from "@/features/actions/action-form";
import { loadActionFormOptions } from "@/features/actions/options";

export const dynamic = "force-dynamic";

export default async function ActionNewPage() {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "action.edit")) {
      redirect("/actions");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const options = await loadActionFormOptions();

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">次回アクション登録</h1>
        <Link
          href="/actions"
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          一覧へ戻る
        </Link>
      </div>
      <ActionForm meta={{ mode: "create" }} options={options} />
    </div>
  );
}
