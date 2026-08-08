import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getCustomerDetail } from "@/lib/customers/read-detail";
import type { CustomerDetail } from "@/lib/customers/types";
import { isCustomerSyncError } from "@/lib/sync/errors";
import { loadCustomerFormOptions } from "@/features/customers/options";
import { CustomerForm } from "@/features/customers/customer-form";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomerEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "customer.edit")) {
      redirect(`/organizations`);
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  if (!PAGE_ID_RE.test(id)) notFound();

  let detail: CustomerDetail;
  try {
    // 編集開始時点の最新値と last_edited_time を取得(楽観ロックの基準)
    detail = await getCustomerDetail({ notionPageId: id, skipCache: true });
  } catch (error) {
    if (isCustomerSyncError(error)) {
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
              href={`/organizations/${id}/edit`}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 hover:bg-slate-50"
            >
              再試行
            </a>
            <Link
              href={`/organizations/${id}`}
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

  // 無効になった既存relationも現在値として選択肢へ含める(「無効」表示)
  const options = await loadCustomerFormOptions({
    selfPageId: detail.notionPageId,
    current: {
      businessCategoryPageIds: detail.businessCategoryPageIds,
      tagPageIds: detail.tagPageIds,
      relationshipPageIds: detail.relationshipPageIds ?? [],
      salesStatusPageId: detail.salesStatusPageId,
      acquisitionRoutePageId: detail.acquisitionRoutePageId,
      priorityPageId: detail.priorityPageId,
      staffPageIds: detail.staffPageIds,
      relatedAccountPageIds: detail.relatedAccountPageIds,
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <Breadcrumbs
        items={[
          { label: "組織一覧", href: "/organizations" },
          {
            label: detail.displayName || "(無題)",
            href: `/organizations/${detail.notionPageId}`,
          },
          { label: "編集" },
        ]}
      />
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">組織編集: {detail.displayName}</h1>
        <Link
          href={`/organizations/${detail.notionPageId}`}
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          詳細へ戻る
        </Link>
      </div>
      <CustomerForm
        meta={{
          mode: "edit",
          notionPageId: detail.notionPageId,
          externalId: detail.externalId,
          lastEditedTime: detail.lastEditedTime,
        }}
        options={options}
        initial={{
          displayName: detail.displayName,
          legalName: detail.legalName,
          officeName: detail.officeName,
          postalCode: detail.postalCode,
          prefecture: detail.prefecture,
          city: detail.city,
          addressLine: detail.addressLine,
          phone: detail.phone,
          email: detail.email,
          representativeName: detail.representativeName,
          website: detail.website,
          businessCategoryPageIds: detail.businessCategoryPageIds,
          tagPageIds: detail.tagPageIds,
          relationshipPageIds: detail.relationshipPageIds ?? [],
          salesStatusPageId: detail.salesStatusPageId,
          acquisitionRoutePageId: detail.acquisitionRoutePageId,
          priorityPageId: detail.priorityPageId,
          staffPageIds: detail.staffPageIds,
          relatedAccountPageIds: detail.relatedAccountPageIds,
          isArchived: detail.isArchived,
        }}
      />
    </div>
  );
}
