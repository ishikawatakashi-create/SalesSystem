import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { CreateProspectListForm } from "@/features/prospects/create-list-form";

export const dynamic = "force-dynamic";

export default async function NewProspectListPage() {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.manage_lists");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  return (
    <div className="mx-auto max-w-lg space-y-3">
      <h1 className="text-base font-bold">営業リストを作成</h1>
      <CreateProspectListForm />
    </div>
  );
}
