import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadContactFormOptions } from "@/features/contacts/options";
import { ContactForm } from "@/features/contacts/contact-form";
import { getInquiryById } from "@/lib/inquiries/read-list";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export default async function CustomerContactNewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
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

  const { id } = await params;
  if (!PAGE_ID_RE.test(id)) notFound();
  const raw = await searchParams;
  const fromInquiry = str(raw, "fromInquiry");

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
          アーカイブ済みの顧客には担当者を組織を追加できません
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

  const options = await loadContactFormOptions({
    currentCustomerPageId: customer.notion_page_id,
  });

  let initial: {
    customerPageId: string;
    name?: string;
    email?: string;
    phone?: string;
  } = { customerPageId: customer.notion_page_id };

  if (fromInquiry && UUID_RE.test(fromInquiry)) {
    const inquiry = await getInquiryById(fromInquiry);
    if (inquiry) {
      initial = {
        ...initial,
        name: inquiry.sender_name || undefined,
        email: inquiry.sender_email || inquiry.reply_to_email || undefined,
        phone: inquiry.phone || undefined,
      };
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">
          先方担当者登録: {customer.display_name}
        </h1>
        <Link
          href={
            fromInquiry ? `/inquiries/${fromInquiry}` : `/organizations/${id}`
          }
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          {fromInquiry ? "お問い合わせへ戻る" : "組織詳細へ戻る"}
        </Link>
      </div>
      <ContactForm
        meta={{
          mode: "create",
          successRedirect: `/organizations/${id}`,
          fromInquiryId:
            fromInquiry && UUID_RE.test(fromInquiry) ? fromInquiry : undefined,
        }}
        options={options}
        lockedCustomerPageId={customer.notion_page_id}
        initial={initial}
      />
    </div>
  );
}
