import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ComplaintForm } from "@/features/complaints/complaint-form";
import { loadComplaintFormOptions } from "@/features/complaints/options";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomerComplaintNewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "complaint.edit")) {
      redirect("/complaints");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  if (!PAGE_ID_RE.test(id)) notFound();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("customer_index")
    .select("notion_page_id,display_name,is_archived")
    .eq("notion_page_id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) notFound();

  const customer = data as {
    notion_page_id: string;
    display_name: string;
    is_archived: boolean;
  };

  if (customer.is_archived) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm font-medium text-slate-900">
          アーカイブ済みの顧客にはクレームを組織を追加できません
        </p>
        <Link
          href={`/organizations/${id}`}
          className="mt-4 inline-block text-xs text-primary underline"
        >
          組織詳細へ戻る
        </Link>
      </div>
    );
  }

  const options = await loadComplaintFormOptions({
    currentCustomerPageId: customer.notion_page_id,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">
          クレーム登録: {customer.display_name}
        </h1>
        <Link
          href={`/organizations/${id}`}
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          組織詳細へ戻る
        </Link>
      </div>
      <ComplaintForm
        meta={{
          mode: "create",
          successRedirect: `/organizations/${id}`,
        }}
        options={options}
        lockedCustomerPageId={customer.notion_page_id}
        initial={{ customerPageId: customer.notion_page_id }}
      />
    </div>
  );
}
