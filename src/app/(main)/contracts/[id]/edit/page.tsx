import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getContractDetail } from "@/lib/contracts/read-detail";
import type { ContractDetail } from "@/lib/contracts/types";
import { isContractSyncError } from "@/lib/sync/errors";
import { ContractForm } from "@/features/contracts/contract-form";
import { loadContractFormOptions } from "@/features/contracts/options";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ContractEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "contract.edit")) {
      redirect("/contracts");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  if (!PAGE_ID_RE.test(id)) notFound();

  let detail: ContractDetail;
  try {
    detail = await getContractDetail({ notionPageId: id, skipCache: true });
  } catch (error) {
    if (isContractSyncError(error)) {
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
              href={`/contracts/${id}/edit`}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 hover:bg-slate-50"
            >
              再試行
            </a>
            <Link
              href={`/contracts/${id}`}
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

  const options = await loadContractFormOptions({
    currentCustomerPageId: detail.customerPageId ?? undefined,
    currentDealPageId: detail.dealPageId ?? undefined,
    currentContractTypePageId: detail.contractTypePageId ?? undefined,
    currentTradeTypePageId: detail.tradeTypePageId ?? undefined,
    currentPaymentStatusPageId: detail.paymentStatusPageId ?? undefined,
    currentStatusPageId: detail.statusPageId ?? undefined,
    currentStaffPageIds: detail.staffPageIds,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">
          契約編集: {detail.title || "(無題)"}
        </h1>
        <Link
          href={`/contracts/${detail.notionPageId}`}
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          詳細へ戻る
        </Link>
      </div>
      <ContractForm
        meta={{
          mode: "edit",
          notionPageId: detail.notionPageId,
          externalId: detail.externalId,
          lastEditedTime: detail.lastEditedTime,
        }}
        options={options}
        initial={{
          title: detail.title,
          customerPageId: detail.customerPageId,
          dealPageId: detail.dealPageId,
          contractTypePageId: detail.contractTypePageId,
          tradeTypePageId: detail.tradeTypePageId,
          paymentStatusPageId: detail.paymentStatusPageId,
          statusPageId: detail.statusPageId,
          staffPageIds: detail.staffPageIds,
          amount: detail.amount,
          contractedAt: detail.contractedAt,
          startDate: detail.startDate,
          endDate: detail.endDate,
          autoRenew: detail.autoRenew,
          billingTerms: detail.billingTerms,
          contractUrl: detail.contractUrl,
          note: detail.note,
        }}
      />
    </div>
  );
}
