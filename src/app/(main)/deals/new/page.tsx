import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { DealForm } from "@/features/deals/deal-form";
import { loadDealFormOptions } from "@/features/deals/options";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export default async function DealNewPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "deal.edit")) {
      redirect("/deals");
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
      redirect("/deals/new");
    }
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("customer_index")
      .select("notion_page_id,is_archived")
      .eq("notion_page_id", customerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      redirect("/deals/new");
    }
    if ((data as { is_archived: boolean }).is_archived) {
      redirect(`/customers/${customerId}`);
    }
    preselectCustomerId = customerId;
  }

  const options = await loadDealFormOptions({
    currentCustomerPageId: preselectCustomerId,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">案件登録</h1>
        <Link
          href="/deals"
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          一覧へ戻る
        </Link>
      </div>
      <DealForm
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
