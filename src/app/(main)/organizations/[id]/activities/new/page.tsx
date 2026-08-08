import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActivityForm } from "@/features/activities/activity-form";
import { loadActivityFormOptions } from "@/features/activities/options";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

function pageIdOrNull(v: string | undefined): string | null {
  if (!v || !PAGE_ID_RE.test(v)) return null;
  return v;
}

export default async function CustomerActivityNewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawParams>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "activity.edit")) {
      redirect("/activities");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  if (!PAGE_ID_RE.test(id)) notFound();

  const rawSearch = await searchParams;
  const bodyPrefill = str(rawSearch, "body")?.slice(0, 2000);
  const dealPageId = pageIdOrNull(str(rawSearch, "deal"));
  const contactPageId = pageIdOrNull(str(rawSearch, "contact"));
  const categoryPageId = pageIdOrNull(str(rawSearch, "category"));

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
          アーカイブ済みの顧客には対応履歴を組織を追加できません
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

  const options = await loadActivityFormOptions({
    currentCustomerPageId: customer.notion_page_id,
    currentDealPageId: dealPageId ?? undefined,
    currentContactPageIds: contactPageId ? [contactPageId] : undefined,
    currentCategoryPageIds: categoryPageId ? [categoryPageId] : undefined,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">
          対応履歴登録: {customer.display_name}
        </h1>
        <Link
          href={`/organizations/${id}`}
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          組織詳細へ戻る
        </Link>
      </div>
      <ActivityForm
        meta={{ mode: "create", successRedirect: `/organizations/${id}` }}
        options={options}
        lockedCustomerPageId={customer.notion_page_id}
        initial={{
          customerPageId: customer.notion_page_id,
          body: bodyPrefill,
          dealPageId,
          contactPageIds: contactPageId ? [contactPageId] : undefined,
          categoryPageIds: categoryPageId ? [categoryPageId] : undefined,
        }}
      />
    </div>
  );
}
