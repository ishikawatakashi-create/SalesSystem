import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { getProspectList } from "@/lib/prospects/lists";
import { ProspectImportWizard } from "@/features/prospects/import-wizard";

export const dynamic = "force-dynamic";

export default async function ProspectListImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    const user = await requireUser();
    requirePermission(user, "prospect.import");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  const list = await getProspectList(id);
  if (!list) redirect("/prospect-lists");

  return (
    <div className="space-y-3">
      <div>
        <Link
          href={`/prospect-lists/${id}`}
          className="text-xs text-slate-500"
        >
          ← {list.name}
        </Link>
        <h1 className="text-base font-bold">CSVインポート</h1>
      </div>
      <ProspectImportWizard listId={id} />
    </div>
  );
}
