import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadContactFormOptions } from "@/features/contacts/options";
import { ContactForm } from "@/features/contacts/contact-form";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export default async function ContactNewPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "contact.edit")) {
      redirect("/contacts");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const params = await searchParams;
  const customerId = str(params, "customerId");
  let preselectCustomerId: string | undefined;

  if (customerId) {
    if (!PAGE_ID_RE.test(customerId)) {
      redirect("/contacts/new");
    }
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("customer_index")
      .select("notion_page_id,is_archived")
      .eq("notion_page_id", customerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      redirect("/contacts/new");
    }
    if ((data as { is_archived: boolean }).is_archived) {
      // アーカイブ顧客への新規所属は不可
      redirect(`/customers/${customerId}`);
    }
    preselectCustomerId = customerId;
  }

  const options = await loadContactFormOptions({
    currentCustomerPageId: preselectCustomerId,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">先方担当者登録</h1>
        <Link
          href="/contacts"
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          一覧へ戻る
        </Link>
      </div>
      <ContactForm
        meta={{ mode: "create" }}
        options={options}
        initial={
          preselectCustomerId
            ? { customerPageId: preselectCustomerId }
            : undefined
        }
      />
    </div>
  );
}
