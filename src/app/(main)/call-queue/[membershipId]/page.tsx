import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import {
  ensureCallClaimForUser,
  loadCallWorkspace,
} from "@/lib/prospects/call-queue";
import { PROSPECT_STAGE_LABELS, type ProspectMembershipStage } from "@/lib/prospects/types";
import { CallWorkspace } from "@/features/prospects/call-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { canStartProspectPromotion } from "@/lib/prospects/presentation";
import { normalizeCallQueueFilter } from "@/lib/prospects/call-filter";

export const dynamic = "force-dynamic";

export default async function CallQueueItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ membershipId: string }>;
  searchParams: Promise<{ list?: string; filter?: string }>;
}) {
  let user;
  try {
    user = await requireUser();
    requirePermission(user, "prospect.call");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const { membershipId } = await params;
  const sp = await searchParams;
  const filter = normalizeCallQueueFilter(sp.filter);
  const workspace = await loadCallWorkspace({
    membershipId,
    userId: user.id,
  });
  if (!workspace) {
    const query = new URLSearchParams({ unavailable: "1" });
    if (sp.list) query.set("list", sp.list);
    query.set("filter", filter);
    redirect(`/call-queue?${query.toString()}`);
  }

  const { membership, prospect, list, contacts, recentAttempts, claimConflict } =
    workspace;

  if (!claimConflict) {
    await ensureCallClaimForUser({
      membershipId,
      userId: user.id,
      claimedBy: (membership.claimed_by as string | null) ?? null,
      claimExpiresAt: (membership.claim_expires_at as string | null) ?? null,
    });
  }

  const assigneeName = membership.assigned_user_id
    ? await (async () => {
        const admin = createAdminClient();
        const { data } = await admin
          .from("app_users")
          .select("display_name")
          .eq("id", String(membership.assigned_user_id))
          .maybeSingle();
        return data?.display_name ? String(data.display_name) : null;
      })()
    : null;

  const stage = String(membership.stage) as ProspectMembershipStage;
  const canPromote =
    hasPermission(user.role, "prospect.promote") &&
    hasPermission(user.role, "customer.edit") &&
    canStartProspectPromotion(String(prospect.promotion_status));

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <Link
          href={`/call-queue?list=${sp.list ?? String(list.id)}&filter=${filter}`}
          className="text-slate-500"
        >
          ← 架電キュー
        </Link>
      </div>
      <CallWorkspace
        membershipId={membershipId}
        prospectId={String(prospect.id)}
        listId={String(list.id)}
        listName={String(list.name ?? "")}
        companyName={String(prospect.company_name)}
        stage={stage}
        stageLabel={PROSPECT_STAGE_LABELS[stage] ?? "状態要確認"}
        assigneeName={assigneeName}
        websiteUrl={(prospect.website_url as string | null) ?? null}
        mainPhone={(prospect.main_phone as string | null) ?? null}
        phoneInvalid={Boolean(prospect.phone_invalid)}
        address={[
          prospect.postal_code,
          prospect.prefecture,
          prospect.city,
          prospect.address,
        ]
          .filter(Boolean)
          .join(" ")}
        industry={(prospect.industry as string | null) ?? null}
        doNotContact={Boolean(prospect.do_not_contact)}
        promotionStatus={String(prospect.promotion_status ?? "none")}
        promotedPageId={
          (prospect.promoted_customer_page_id as string | null) ?? null
        }
        formalMatch={
          prospect.formal_org_match_page_id
            ? {
                pageId: String(prospect.formal_org_match_page_id),
                confidence: String(
                  prospect.formal_org_match_confidence ?? "probable",
                ),
              }
            : null
        }
        contacts={(contacts ?? []).map((c) => ({
          id: String(c.id),
          name: String(c.name),
          department: (c.department as string | null) ?? null,
          title: (c.title as string | null) ?? null,
          phone: (c.phone as string | null) ?? null,
          email: (c.email as string | null) ?? null,
          isPrimary: Boolean(c.is_primary),
        }))}
        recentAttempts={(recentAttempts ?? []).map((a) => ({
          id: String(a.id),
          result: String(a.result),
          note: (a.note as string | null) ?? null,
          completedAt: String(a.completed_at),
        }))}
        nextContactAt={(membership.next_contact_at as string | null) ?? null}
        claimConflict={claimConflict?.byName ?? null}
        filter={filter}
        canPromote={canPromote}
      />
    </div>
  );
}
