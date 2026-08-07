import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getContactDetail } from "@/lib/contacts/read-detail";
import type { ContactDetail } from "@/lib/contacts/types";
import { isContactSyncError } from "@/lib/sync/errors";
import { loadContactFormOptions } from "@/features/contacts/options";
import { ContactForm } from "@/features/contacts/contact-form";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ContactEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
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

  let detail: ContactDetail;
  try {
    detail = await getContactDetail({ notionPageId: id, skipCache: true });
  } catch (error) {
    if (isContactSyncError(error)) {
      if (error.code === "not_found") notFound();
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <p className="text-sm font-medium text-slate-900">
            Notionへの接続に失敗しました
          </p>
          <p className="mt-1 text-xs text-slate-500">
            編集を開始できません。通信状態を確認のうえ再試行してください。
          </p>
          <div className="mt-4 flex items-center justify-center gap-3 text-xs">
            <a
              href={`/contacts/${id}/edit`}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 hover:bg-slate-50"
            >
              再試行
            </a>
            <Link
              href={`/contacts/${id}`}
              className="text-slate-500 hover:text-slate-900"
            >
              詳細へ戻る
            </Link>
          </div>
        </div>
      );
    }
    throw error;
  }

  const options = await loadContactFormOptions({
    selfContactId: detail.notionPageId,
    currentCustomerPageId: detail.customerPageId ?? undefined,
    currentContactTypePageId: detail.contactTypePageId ?? undefined,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <Breadcrumbs
        items={[
          { label: "担当者一覧", href: "/contacts" },
          {
            label: detail.name || "(無題)",
            href: `/contacts/${detail.notionPageId}`,
          },
          { label: "編集" },
        ]}
      />
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">先方担当者編集: {detail.name}</h1>
        <Link
          href={`/contacts/${detail.notionPageId}`}
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          詳細へ戻る
        </Link>
      </div>
      <ContactForm
        meta={{
          mode: "edit",
          notionPageId: detail.notionPageId,
          externalId: detail.externalId,
          lastEditedTime: detail.lastEditedTime,
        }}
        options={options}
        initial={{
          name: detail.name,
          nameKana: detail.nameKana,
          customerPageId: detail.customerPageId ?? "",
          department: detail.department,
          title: detail.title,
          phone: detail.phone,
          email: detail.email,
          contactTypePageId: detail.contactTypePageId,
          note: detail.note,
          isActive: detail.isActive,
        }}
      />
    </div>
  );
}
