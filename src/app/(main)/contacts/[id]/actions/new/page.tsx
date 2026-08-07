import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/features/actions/action-form";
import { loadActionFormOptions } from "@/features/actions/options";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ContactActionNewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "action.edit")) {
      redirect("/actions");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  if (!PAGE_ID_RE.test(id)) notFound();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contact_index")
    .select("notion_page_id,name,customer_page_id")
    .eq("notion_page_id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) notFound();

  const contact = data as {
    notion_page_id: string;
    name: string;
    customer_page_id: string | null;
  };
  if (!contact.customer_page_id) notFound();

  const options = await loadActionFormOptions({
    currentCustomerPageId: contact.customer_page_id,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">
          次回アクション登録: {contact.name}
        </h1>
        <Link
          href={`/contacts/${id}`}
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          担当者詳細へ戻る
        </Link>
      </div>
      <p className="text-xs text-slate-500">
        アクションに先方担当者フィールドはないため、所属顧客を事前選択しています。
      </p>
      <ActionForm
        meta={{ mode: "create", successRedirect: `/contacts/${id}` }}
        options={options}
        lockedCustomerPageId={contact.customer_page_id}
        initial={{ customerPageId: contact.customer_page_id }}
        showActivityField
      />
    </div>
  );
}
