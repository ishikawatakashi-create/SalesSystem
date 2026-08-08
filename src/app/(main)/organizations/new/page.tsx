import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { loadCustomerFormOptions } from "@/features/customers/options";
import { CustomerForm } from "@/features/customers/customer-form";
import { getInquiryById } from "@/lib/inquiries/read-list";
import { resolveRelationshipPageIdsBySemanticKeys } from "@/lib/organizations/resolve-relationship-semantics";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

function parseRelKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];
}

export default async function OrganizationNewPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "customer.edit")) {
      redirect("/organizations");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const raw = await searchParams;
  const fromInquiry = str(raw, "fromInquiry");
  const relKeys = parseRelKeys(str(raw, "rel"));
  const options = await loadCustomerFormOptions();

  let relationshipPageIds: string[] = [];
  if (relKeys.length > 0) {
    const admin = createAdminClient();
    relationshipPageIds = await resolveRelationshipPageIdsBySemanticKeys(
      admin,
      relKeys,
    );
  }

  let initial:
    | {
        displayName?: string;
        legalName?: string;
        phone?: string;
        email?: string;
        relationshipPageIds?: string[];
      }
    | undefined = relationshipPageIds.length > 0
    ? { relationshipPageIds }
    : undefined;

  if (fromInquiry && UUID_RE.test(fromInquiry)) {
    const inquiry = await getInquiryById(fromInquiry);
    if (inquiry) {
      const name = inquiry.company_name || inquiry.sender_name || "";
      initial = {
        ...initial,
        displayName: name || undefined,
        legalName: inquiry.company_name || undefined,
        phone: inquiry.phone || undefined,
        email: inquiry.sender_email || inquiry.reply_to_email || undefined,
        relationshipPageIds:
          relationshipPageIds.length > 0
            ? relationshipPageIds
            : initial?.relationshipPageIds,
      };
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">組織を追加</h1>
        <Link
          href={fromInquiry ? `/inquiries/${fromInquiry}` : "/organizations"}
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          {fromInquiry ? "お問い合わせへ戻る" : "一覧へ戻る"}
        </Link>
      </div>
      {fromInquiry && (
        <p className="text-xs text-slate-500">
          お問い合わせ内容を初期入力しています。内容を確認してから登録してください。
        </p>
      )}
      <CustomerForm
        meta={{
          mode: "create",
          fromInquiryId:
            fromInquiry && UUID_RE.test(fromInquiry) ? fromInquiry : undefined,
        }}
        options={options}
        initial={initial}
      />
    </div>
  );
}
