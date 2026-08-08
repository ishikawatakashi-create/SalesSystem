import "server-only";

import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { customerCreate } from "@/lib/sync/write-pipeline";
import { contactCreate } from "@/lib/sync/contact-write-pipeline";
import { activityCreate } from "@/lib/sync/activity-write-pipeline";
import { actionCreate } from "@/lib/sync/action-write-pipeline";
import { dealCreate } from "@/lib/sync/deal-write-pipeline";
import { writeProspectAudit } from "@/lib/prospects/audit";
import { CALL_RESULT_LABELS, type CallResult } from "@/lib/prospects/call-results";
import {
  resolveRelationshipPageIdsBySemanticKeys,
} from "@/lib/organizations/resolve-relationship-semantics";
import type { OrganizationRelationshipSemanticKey } from "@/lib/organizations/relationship";
import { normalizeEmailOrNull } from "@/lib/normalize";
import { normalizePhone } from "@/lib/normalize";
import { uuidV5 } from "@/lib/notion/ids";

export type PromoteMode = "link_existing" | "create_new";

export type PromoteProspectPayload = {
  prospectId: string;
  membershipId: string | null;
  mode: PromoteMode;
  /** link_existing */
  existingCustomerPageId?: string | null;
  /** create_new */
  relationshipSemanticKeys?: OrganizationRelationshipSemanticKey[];
  contactIds?: string[];
  copyActivityCount?: 0 | 1 | 3;
  createNextAction?: boolean;
  createDeal?: boolean;
  deal?: {
    title: string;
    expectedAmount?: number | null;
  } | null;
  actorId: string;
  actorName: string;
  actorStaffPageId: string | null;
  requestId: string;
};

export type PromoteProgress = {
  status: string;
  customerPageId: string | null;
  customerExternalId: string | null;
  contactPageIds: string[];
  activityPageIds: string[];
  actionPageId: string | null;
  dealPageId: string | null;
  error: string | null;
};

/**
 * Prospect → formal Organization 昇格。
 * 部分失敗時は promotion_status を進め、同 request_id で resume 可能。
 */
export async function promoteProspect(
  payload: PromoteProspectPayload,
): Promise<PromoteProgress> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: prospect, error: pErr } = await admin
    .from("prospects")
    .select("*")
    .eq("id", payload.prospectId)
    .maybeSingle();
  if (pErr || !prospect) throw new Error("prospect_not_found");
  if (prospect.archived_at) throw new Error("prospect_archived");

  // idempotent completed
  if (
    prospect.promotion_status === "completed" &&
    prospect.promoted_customer_page_id
  ) {
    return {
      status: "completed",
      customerPageId: String(prospect.promoted_customer_page_id),
      customerExternalId:
        (prospect.promoted_customer_external_id as string | null) ?? null,
      contactPageIds: [],
      activityPageIds: [],
      actionPageId: null,
      dealPageId: null,
      error: null,
    };
  }

  // claim request_id
  if (
    prospect.promotion_request_id &&
    prospect.promotion_request_id !== payload.requestId &&
    prospect.promotion_status !== "failed" &&
    prospect.promotion_status !== "none"
  ) {
    throw new Error("promotion_in_progress");
  }

  if (!prospect.promotion_request_id) {
    await admin
      .from("prospects")
      .update({
        promotion_status: "pending",
        promotion_request_id: payload.requestId,
        promotion_error: null,
        updated_at: now,
      })
      .eq("id", payload.prospectId);
  }

  await writeProspectAudit({
    actorId: payload.actorId,
    actorName: payload.actorName,
    action: "prospect.promotion_started",
    entityType: "prospect",
    entityId: payload.prospectId,
    requestId: payload.requestId,
    changedFields: {
      mode: payload.mode,
      membership_id: payload.membershipId,
    },
  });

  let customerPageId =
    (prospect.promoted_customer_page_id as string | null) ?? null;
  let customerExternalId =
    (prospect.promoted_customer_external_id as string | null) ?? null;
  let status = String(prospect.promotion_status ?? "pending");
  // resume after partial failure: if org already linked, continue from contacts
  if (
    customerPageId &&
    (status === "failed" || status === "pending" || status === "none")
  ) {
    status = "organization_created";
  }

  try {
    // --- Organization ---
    if (!customerPageId) {
      if (payload.mode === "link_existing") {
        if (!payload.existingCustomerPageId) {
          throw new Error("existing_customer_required");
        }
        const { data: cust } = await admin
          .from("customer_index")
          .select("notion_page_id,external_id,display_name")
          .eq("notion_page_id", payload.existingCustomerPageId)
          .eq("is_archived", false)
          .maybeSingle();
        if (!cust) throw new Error("existing_customer_not_found");
        customerPageId = String(cust.notion_page_id);
        customerExternalId = (cust.external_id as string | null) ?? null;
        await writeProspectAudit({
          actorId: payload.actorId,
          actorName: payload.actorName,
          action: "prospect.promotion_linked_existing",
          entityType: "prospect",
          entityId: payload.prospectId,
          requestId: payload.requestId,
          changedFields: {
            customer_page_id: customerPageId,
            customer_external_id: customerExternalId,
          },
        });
      } else {
        const keys: OrganizationRelationshipSemanticKey[] = [
          ...(payload.relationshipSemanticKeys?.length
            ? payload.relationshipSemanticKeys
            : (["prospect"] as OrganizationRelationshipSemanticKey[])),
        ];
        if (!keys.includes("prospect")) {
          keys.unshift("prospect");
        }
        const relationshipPageIds =
          await resolveRelationshipPageIdsBySemanticKeys(admin, keys);
        const createReq = uuidV5(`prospect-promote:${payload.requestId}:org`);
        const result = await customerCreate({
          requestId: createReq,
          actorId: payload.actorId,
          actorName: payload.actorName,
          input: {
            displayName: String(prospect.company_name),
            legalName: null,
            officeName: null,
            postalCode: (prospect.postal_code as string | null) ?? null,
            prefecture: (prospect.prefecture as string | null) ?? null,
            city: (prospect.city as string | null) ?? null,
            addressLine: (prospect.address as string | null) ?? null,
            phone: (prospect.main_phone as string | null) ?? null,
            email: null,
            representativeName: null,
            website: (prospect.website_url as string | null) ?? null,
            businessCategoryPageIds: [],
            tagPageIds: [],
            relationshipPageIds,
            salesStatusPageId: null,
            acquisitionRoutePageId: null,
            priorityPageId: null,
            staffPageIds: payload.actorStaffPageId
              ? [payload.actorStaffPageId]
              : [],
            relatedAccountPageIds: [],
            isArchived: false,
          },
        });
        if (!result.notionPageId) {
          throw new Error(
            `organization_create_incomplete:${result.status}:${result.warning ?? ""}`,
          );
        }
        customerPageId = result.notionPageId;
        customerExternalId = result.externalId;
        await writeProspectAudit({
          actorId: payload.actorId,
          actorName: payload.actorName,
          action: "prospect.promotion_created_organization",
          entityType: "prospect",
          entityId: payload.prospectId,
          requestId: payload.requestId,
          changedFields: {
            customer_page_id: customerPageId,
            customer_external_id: customerExternalId,
            relationships: keys,
          },
        });
      }

      await admin
        .from("prospects")
        .update({
          promotion_status: "organization_created",
          promoted_customer_page_id: customerPageId,
          promoted_customer_external_id: customerExternalId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.prospectId);
      status = "organization_created";
    }

    // --- Contacts ---
    const contactPageIds: string[] = [];
    if (status === "organization_created" || status === "pending") {
      status = "organization_created";
    }
    if (
      status === "organization_created" ||
      status === "contacts_done" ||
      status === "activity_done" ||
      status === "action_done"
    ) {
      // resume: skip if already past contacts — tracked loosely via status
    }

    if (status === "organization_created") {
      const ids = payload.contactIds ?? [];
      if (ids.length > 0) {
        const { data: contacts } = await admin
          .from("prospect_contacts")
          .select("*")
          .in("id", ids)
          .eq("prospect_id", payload.prospectId)
          .is("archived_at", null);
        for (const c of contacts ?? []) {
          const contactReq = uuidV5(
            `prospect-promote:${payload.requestId}:contact:${c.id}`,
          );
          // duplicate check against formal contacts
          const email = normalizeEmailOrNull(c.email as string | null);
          const phone = normalizePhone(c.phone as string | null);
          if (email) {
            const { data: dup } = await admin
              .from("contact_index")
              .select("notion_page_id")
              .eq("customer_page_id", customerPageId!)
              .eq("email", email)
              .eq("is_active", true)
              .limit(1)
              .maybeSingle();
            if (dup?.notion_page_id) {
              contactPageIds.push(String(dup.notion_page_id));
              continue;
            }
          }
          if (phone) {
            const { data: dup } = await admin
              .from("contact_index")
              .select("notion_page_id")
              .eq("customer_page_id", customerPageId!)
              .eq("phone_normalized", phone)
              .eq("is_active", true)
              .limit(1)
              .maybeSingle();
            if (dup?.notion_page_id) {
              contactPageIds.push(String(dup.notion_page_id));
              continue;
            }
          }

          const created = await contactCreate({
            requestId: contactReq,
            actorId: payload.actorId,
            actorName: payload.actorName,
            input: {
              name: String(c.name),
              nameKana: null,
              customerPageId: customerPageId!,
              department: (c.department as string | null) ?? null,
              title: (c.title as string | null) ?? null,
              phone: (c.phone as string | null) ?? null,
              email: (c.email as string | null) ?? null,
              contactTypePageId: null,
              note: null,
              isActive: true,
            },
          });
          if (created.notionPageId) {
            contactPageIds.push(created.notionPageId);
          }
        }
        await writeProspectAudit({
          actorId: payload.actorId,
          actorName: payload.actorName,
          action: "prospect.promotion_contacts_created",
          entityType: "prospect",
          entityId: payload.prospectId,
          requestId: payload.requestId,
          changedFields: {
            contact_page_ids: contactPageIds,
            selected_count: ids.length,
          },
        });
      }
      await admin
        .from("prospects")
        .update({
          promotion_status: "contacts_done",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.prospectId);
      status = "contacts_done";
    }

    // --- Activities (selected recent meaningful attempts) ---
    const activityPageIds: string[] = [];
    if (status === "contacts_done") {
      const copyCount = payload.copyActivityCount ?? 1;
      if (copyCount > 0) {
        const { data: attempts } = await admin
          .from("prospect_call_attempts")
          .select("*")
          .eq("prospect_id", payload.prospectId)
          .is("archived_at", null)
          .order("completed_at", { ascending: false })
          .limit(20);
        const meaningful = (attempts ?? []).filter((a) =>
          [
            "connected",
            "send_materials",
            "interested",
            "appointment",
            "callback_requested",
            "not_interested",
            "do_not_contact",
          ].includes(String(a.result)),
        );
        const selected = (meaningful.length > 0 ? meaningful : attempts ?? []).slice(
          0,
          copyCount,
        );

        let listName = "";
        if (payload.membershipId) {
          const { data: mem } = await admin
            .from("prospect_list_memberships")
            .select("prospect_list_id")
            .eq("id", payload.membershipId)
            .maybeSingle();
          if (mem) {
            const { data: list } = await admin
              .from("prospect_lists")
              .select("name")
              .eq("id", String(mem.prospect_list_id))
              .maybeSingle();
            listName = String(list?.name ?? "");
          }
        }

        for (const a of selected) {
          const resultKey = String(a.result) as CallResult;
          const label = CALL_RESULT_LABELS[resultKey] ?? resultKey;
          const body = [
            `架電結果: ${label}`,
            a.note ? `メモ: ${String(a.note)}` : null,
            listName ? `元営業リスト: ${listName}` : null,
            `日時: ${String(a.completed_at)}`,
          ]
            .filter(Boolean)
            .join("\n");
          const actReq = uuidV5(
            `prospect-promote:${payload.requestId}:activity:${a.id}`,
          );
          const created = await activityCreate({
            requestId: actReq,
            actorId: payload.actorId,
            actorName: payload.actorName,
            input: {
              title: "営業リストから見込化",
              customerPageId: customerPageId!,
              dealPageId: null,
              contactPageIds: contactPageIds.slice(0, 1),
              activityAt: String(a.completed_at),
              categoryPageIds: [],
              summary: `架電結果: ${label}`,
              nextActionNote: null,
              nextActionDate: null,
              body,
              batchId: null,
            },
          });
          if (created.notionPageId) {
            activityPageIds.push(created.notionPageId);
          }
        }
        await writeProspectAudit({
          actorId: payload.actorId,
          actorName: payload.actorName,
          action: "prospect.promotion_activity_created",
          entityType: "prospect",
          entityId: payload.prospectId,
          requestId: payload.requestId,
          changedFields: {
            activity_page_ids: activityPageIds,
            count: activityPageIds.length,
          },
        });
      }
      await admin
        .from("prospects")
        .update({
          promotion_status: "activity_done",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.prospectId);
      status = "activity_done";
    }

    // --- Next Action ---
    let actionPageId: string | null = null;
    if (status === "activity_done") {
      if (payload.createNextAction !== false && payload.membershipId) {
        const { data: mem } = await admin
          .from("prospect_list_memberships")
          .select("next_contact_at")
          .eq("id", payload.membershipId)
          .maybeSingle();
        const nextAt = mem?.next_contact_at as string | null;
        if (nextAt) {
          const dueDate = toJstYmd(nextAt);
          const openStatus = await findOpenActionStatusPageId();
          if (openStatus && dueDate) {
            const actReq = uuidV5(
              `prospect-promote:${payload.requestId}:action`,
            );
            const created = await actionCreate({
              requestId: actReq,
              actorId: payload.actorId,
              actorName: payload.actorName,
              input: {
                title: `${String(prospect.company_name)}へ再連絡`,
                customerPageId: customerPageId!,
                dealPageId: null,
                activityPageId: activityPageIds[0] ?? null,
                staffPageId: payload.actorStaffPageId,
                dueDate,
                statusPageId: openStatus,
                priorityPageId: null,
                completedAt: null,
              },
            });
            actionPageId = created.notionPageId;
            await writeProspectAudit({
              actorId: payload.actorId,
              actorName: payload.actorName,
              action: "prospect.promotion_action_created",
              entityType: "prospect",
              entityId: payload.prospectId,
              requestId: payload.requestId,
              changedFields: { action_page_id: actionPageId, due_date: dueDate },
            });
          }
        }
      }
      await admin
        .from("prospects")
        .update({
          promotion_status: "action_done",
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.prospectId);
      status = "action_done";
    }

    // --- Optional Deal ---
    let dealPageId: string | null = null;
    if (status === "action_done") {
      if (payload.createDeal && payload.deal?.title) {
        const dealReq = uuidV5(`prospect-promote:${payload.requestId}:deal`);
        const created = await dealCreate({
          requestId: dealReq,
          actorId: payload.actorId,
          actorName: payload.actorName,
          input: {
            title: payload.deal.title,
            customerPageId: customerPageId!,
            contactPageIds: contactPageIds.slice(0, 1),
            businessCategoryPageId: null,
            productName: null,
            stagePageId: null,
            statusPageId: null,
            staffPageIds: payload.actorStaffPageId
              ? [payload.actorStaffPageId]
              : [],
            expectedAmount: payload.deal.expectedAmount ?? null,
            contractAmount: null,
            probability: null,
            expectedCloseDate: null,
            contractedAt: null,
            periodStart: null,
            periodEnd: null,
            lostReason: null,
            note: "営業リストから見込化時に作成",
          },
        });
        dealPageId = created.notionPageId;
        await writeProspectAudit({
          actorId: payload.actorId,
          actorName: payload.actorName,
          action: "prospect.promotion_deal_created",
          entityType: "prospect",
          entityId: payload.prospectId,
          requestId: payload.requestId,
          changedFields: { deal_page_id: dealPageId },
        });
      }

      // mark completed + convert all memberships
      const completedAt = new Date().toISOString();
      await admin
        .from("prospects")
        .update({
          promotion_status: "completed",
          promoted_at: completedAt,
          promoted_by: payload.actorId,
          promoted_customer_page_id: customerPageId,
          promoted_customer_external_id: customerExternalId,
          promotion_error: null,
          updated_at: completedAt,
        })
        .eq("id", payload.prospectId);

      await admin
        .from("prospect_list_memberships")
        .update({
          stage: "converted",
          claimed_by: null,
          claimed_at: null,
          claim_expires_at: null,
          updated_at: completedAt,
        })
        .eq("prospect_id", payload.prospectId)
        .is("archived_at", null)
        .neq("stage", "converted");

      await writeProspectAudit({
        actorId: payload.actorId,
        actorName: payload.actorName,
        action: "prospect.promotion_completed",
        entityType: "prospect",
        entityId: payload.prospectId,
        requestId: payload.requestId,
        changedFields: {
          customer_page_id: customerPageId,
          converted_memberships: true,
        },
      });
      status = "completed";
    }

    return {
      status,
      customerPageId,
      customerExternalId,
      contactPageIds,
      activityPageIds,
      actionPageId,
      dealPageId,
      error: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "promotion_failed";
    await admin
      .from("prospects")
      .update({
        promotion_status: "failed",
        promotion_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.prospectId);
    await writeProspectAudit({
      actorId: payload.actorId,
      actorName: payload.actorName,
      action: "prospect.promotion_failed",
      entityType: "prospect",
      entityId: payload.prospectId,
      requestId: payload.requestId,
      changedFields: { error: message.slice(0, 200) },
    });
    throw e;
  }
}

function toJstYmd(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !day) return null;
  return `${y}-${m}-${day}`;
}

async function findOpenActionStatusPageId(): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("masters_cache")
    .select("notion_page_id,semantic_key,name")
    .eq("master_type", "アクションステータス")
    .eq("is_active", true)
    .limit(20);
  const open =
    data?.find((r) => r.semantic_key === "open") ??
    data?.find((r) => String(r.name).includes("未完了") || String(r.name).includes("オープン"));
  return open ? String(open.notion_page_id) : data?.[0]
    ? String(data[0].notion_page_id)
    : null;
}

export async function enqueueProspectPromote(input: {
  payload: Omit<PromoteProspectPayload, "actorId" | "actorName" | "actorStaffPageId"> & {
    actorId: string;
    actorName: string;
    actorStaffPageId: string | null;
  };
}): Promise<{ jobId: string }> {
  const { enqueueJob } = await import("@/lib/jobs/queue");
  const job = await enqueueJob({
    kind: "prospect_promote",
    payload: input.payload as unknown as Record<string, unknown>,
    priority: 40,
    createdBy: input.payload.actorId,
    idempotencyKey: `prospect_promote:${input.payload.requestId}`,
  });
  return { jobId: job.id };
}

export function newPromotionRequestId(): string {
  return randomUUID();
}
