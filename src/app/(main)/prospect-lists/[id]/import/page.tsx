import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { getProspectList } from "@/lib/prospects/lists";
import { ProspectImportWizard } from "@/features/prospects/import-wizard";
import { EmptyState } from "@/components/ui/state-messages";

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
  if (list.archived_at || list.status === "archived") {
    return (
      <div className="space-y-3">
        <h1 className="text-base font-bold">CSVから営業候補を取り込む</h1>
        <EmptyState
          title="この営業リストにはCSVを取り込めません"
          hint="営業リストがアーカイブ済みです。営業リスト一覧から別の取込先を選んでください。"
          actionHref="/prospect-lists"
          actionLabel="営業リスト一覧へ"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Link
          href={`/prospect-lists/${id}`}
          className="text-xs text-slate-500"
        >
          ← {list.name}
        </Link>
        <h1 className="text-base font-bold">CSVから営業候補を取り込む</h1>
        <p className="text-xs text-slate-600">
          CSVの列を営業候補の項目に対応付け、取込前に内容を確認します。
        </p>
      </div>
      <ProspectImportWizard listId={id} />
    </div>
  );
}
