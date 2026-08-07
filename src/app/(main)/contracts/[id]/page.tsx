import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getContractDetail } from "@/lib/contracts/read-detail";
import type { ContractDetail } from "@/lib/contracts/types";
import { isContractSyncError } from "@/lib/sync/errors";
import { ContractDetailView } from "@/features/contracts/contract-detail-view";
import { loadDetailLabelMaps } from "@/features/contracts/list-data";

export const dynamic = "force-dynamic";

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export default async function ContractDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawParams>;
}) {
  let canEdit = false;
  try {
    const user = await requireUser();
    canEdit = hasPermission(user.role, "contract.edit");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  const rawSearch = await searchParams;
  const savedNote = str(rawSearch, "saved") === "1";
  if (!PAGE_ID_RE.test(id)) notFound();

  let detail: ContractDetail;
  try {
    detail = await getContractDetail({ notionPageId: id });
  } catch (error) {
    if (isContractSyncError(error)) {
      if (error.code === "not_found") notFound();
      if (error.code === "in_trash") {
        return (
          <div className="mx-auto max-w-md py-16 text-center text-sm text-slate-600">
            この契約はNotionのゴミ箱にあります。
            <div className="mt-3">
              <Link href="/contracts" className="text-xs text-primary underline">
                一覧へ戻る
              </Link>
            </div>
          </div>
        );
      }
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <p className="text-sm font-medium text-slate-900">
            Notionへの接続に失敗しました
          </p>
          <p className="mt-1 text-xs text-slate-500">
            正本データを取得できないため、この画面ではキャッシュを表示しません。
            通信状態を確認のうえ再試行してください。
          </p>
          <div className="mt-4 flex items-center justify-center gap-3 text-xs">
            <a
              href={`/contracts/${id}`}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 hover:bg-slate-50"
            >
              再試行
            </a>
            <Link
              href="/contracts"
              className="text-slate-500 hover:text-slate-900"
            >
              一覧へ戻る
            </Link>
          </div>
        </div>
      );
    }
    throw error;
  }

  const labels = await loadDetailLabelMaps(detail);

  return (
    <ContractDetailView
      detail={detail}
      labels={labels}
      canEdit={canEdit}
      savedNote={savedNote}
    />
  );
}
