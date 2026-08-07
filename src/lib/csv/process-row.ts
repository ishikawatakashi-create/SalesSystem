/**
 * import_rows.staged から実 write pipeline を呼び出す。
 */
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { uuidV5 } from "@/lib/notion/ids";
import { customerCreate, customerUpdate } from "@/lib/sync/write-pipeline";
import { contactCreate, contactUpdate } from "@/lib/sync/contact-write-pipeline";
import { dealCreate, dealUpdate } from "@/lib/sync/deal-write-pipeline";
import {
  activityCreate,
  activityUpdate,
} from "@/lib/sync/activity-write-pipeline";
import { actionCreate, actionUpdate } from "@/lib/sync/action-write-pipeline";
import {
  contractCreate,
  contractUpdate,
} from "@/lib/sync/contract-write-pipeline";
import {
  complaintCreate,
  complaintUpdate,
} from "@/lib/sync/complaint-write-pipeline";
import { requestCustomerExpectedAmountRecalc } from "@/lib/deals/request-recalc";
import { requestCustomerLatestActivityRecalc } from "@/lib/activities/request-rollup";
import { requestNextActionRecalc } from "@/lib/actions/request-rollup";
import type { ImportEntity } from "@/lib/csv/entities";
import type { CustomerWriteInput } from "@/lib/customers/types";
import type { ContactWriteInput } from "@/lib/contacts/types";
import type { DealWriteInput } from "@/lib/deals/types";
import type { ActivityWriteInput } from "@/lib/activities/types";
import type { ActionWriteInput } from "@/lib/actions/types";
import type { ContractWriteInput } from "@/lib/contracts/types";
import type { ComplaintWriteInput } from "@/lib/complaints/types";

type Admin = ReturnType<typeof createAdminClient>;

export type ProcessImportRowResult = {
  ok: boolean;
  notionPageId?: string | null;
  externalId?: string | null;
  errorCode?: string;
};

async function loadExpectedEdited(
  admin: Admin,
  table: string,
  pageId: string,
): Promise<string> {
  const { data } = await admin
    .from(table)
    .select("notion_last_edited_at")
    .eq("notion_page_id", pageId)
    .maybeSingle();
  const row = data as { notion_last_edited_at?: string | null } | null;
  return row?.notion_last_edited_at ?? new Date().toISOString();
}

export async function processImportRow(input: {
  admin: Admin;
  importJobId: string;
  entityType: ImportEntity;
  actorId: string;
  actorName: string;
  row: {
    id: string;
    row_number: number;
    external_id: string | null;
    decision: string | null;
    matched_page_id: string | null;
    notion_page_id: string | null;
    staged: Record<string, unknown> | null;
    status: string;
  };
}): Promise<ProcessImportRowResult> {
  const staged = input.row.staged ?? {};
  const externalId =
    (input.row.external_id as string) ||
    String(staged.externalId ?? "") ||
    uuidV5(`csv-row:${input.importJobId}:${input.row.row_number}`);
  const requestId = uuidV5(
    `csv-req:${input.importJobId}:${input.row.row_number}`,
  );
  const decision = input.row.decision ?? "create";

  if (decision === "skip" || input.row.status === "skipped") {
    await input.admin
      .from("import_rows")
      .update({ status: "skipped" })
      .eq("id", input.row.id);
    return { ok: true, externalId, notionPageId: null };
  }

  try {
    let notionPageId: string | null = null;
    const isUpdate =
      decision === "update" &&
      Boolean(input.row.matched_page_id || input.row.notion_page_id);
    const pageId = (input.row.matched_page_id ||
      input.row.notion_page_id) as string | null;

    switch (input.entityType) {
      case "customers": {
        const write: CustomerWriteInput = {
          displayName: String(staged.displayName ?? ""),
          legalName: (staged.legalName as string) ?? null,
          officeName: (staged.officeName as string) ?? null,
          postalCode: (staged.postalCode as string) ?? null,
          prefecture: (staged.prefecture as string) ?? null,
          city: (staged.city as string) ?? null,
          addressLine: (staged.addressLine as string) ?? null,
          phone: (staged.phone as string) ?? null,
          email: (staged.email as string) ?? null,
          representativeName: (staged.representativeName as string) ?? null,
          website: (staged.website as string) ?? null,
          businessCategoryPageIds:
            (staged.businessCategoryPageIds as string[]) ?? [],
          tagPageIds: (staged.tagPageIds as string[]) ?? [],
          salesStatusPageId: (staged.salesStatusPageId as string) ?? null,
          acquisitionRoutePageId:
            (staged.acquisitionRoutePageId as string) ?? null,
          priorityPageId: (staged.priorityPageId as string) ?? null,
          staffPageIds: (staged.staffPageIds as string[]) ?? [],
          relatedAccountPageIds:
            (staged.relatedAccountPageIds as string[]) ?? [],
          isArchived: Boolean(staged.isArchived ?? false),
        };
        if (isUpdate && pageId) {
          const result = await customerUpdate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            notionPageId: pageId,
            externalId,
            expectedLastEditedTime: await loadExpectedEdited(
              input.admin,
              "customer_index",
              pageId,
            ),
            input: write,
          });
          notionPageId = result.notionPageId;
        } else {
          const result = await customerCreate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            input: write,
            externalId,
          });
          notionPageId = result.notionPageId;
        }
        break;
      }
      case "contacts": {
        const write: ContactWriteInput = {
          name: String(staged.name ?? ""),
          nameKana: (staged.nameKana as string) ?? null,
          customerPageId: String(staged.customerPageId ?? ""),
          department: (staged.department as string) ?? null,
          title: (staged.title as string) ?? null,
          phone: (staged.phone as string) ?? null,
          email: (staged.email as string) ?? null,
          contactTypePageId: (staged.contactTypePageId as string) ?? null,
          note: (staged.note as string) ?? null,
          isActive: staged.isActive == null ? true : Boolean(staged.isActive),
        };
        if (isUpdate && pageId) {
          const result = await contactUpdate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            notionPageId: pageId,
            externalId,
            expectedLastEditedTime: await loadExpectedEdited(
              input.admin,
              "contact_index",
              pageId,
            ),
            input: write,
          });
          notionPageId = result.notionPageId;
        } else {
          const result = await contactCreate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            input: write,
            externalId,
          });
          notionPageId = result.notionPageId;
        }
        break;
      }
      case "deals": {
        const write: DealWriteInput = {
          title: String(staged.title ?? ""),
          customerPageId: String(staged.customerPageId ?? ""),
          contactPageIds: (staged.contactPageIds as string[]) ?? [],
          businessCategoryPageId:
            (staged.businessCategoryPageId as string) ?? null,
          productName: (staged.productName as string) ?? null,
          stagePageId: (staged.stagePageId as string) ?? null,
          staffPageIds: (staged.staffPageIds as string[]) ?? [],
          expectedAmount:
            staged.expectedAmount == null
              ? null
              : Number(staged.expectedAmount),
          contractAmount:
            staged.contractAmount == null
              ? null
              : Number(staged.contractAmount),
          probability:
            staged.probability == null ? null : Number(staged.probability),
          expectedCloseDate: (staged.expectedCloseDate as string) ?? null,
          contractedAt: (staged.contractedAt as string) ?? null,
          periodStart: (staged.periodStart as string) ?? null,
          periodEnd: (staged.periodEnd as string) ?? null,
          lostReason: (staged.lostReason as string) ?? null,
          statusPageId: (staged.statusPageId as string) ?? null,
          note: (staged.note as string) ?? null,
        };
        if (isUpdate && pageId) {
          const result = await dealUpdate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            notionPageId: pageId,
            externalId,
            expectedLastEditedTime: await loadExpectedEdited(
              input.admin,
              "deal_index",
              pageId,
            ),
            input: write,
          });
          notionPageId = result.notionPageId;
        } else {
          const result = await dealCreate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            input: write,
            externalId,
          });
          notionPageId = result.notionPageId;
        }
        await requestCustomerExpectedAmountRecalc({
          customerPageIds: [write.customerPageId],
          sourceDealExternalId: externalId,
        });
        break;
      }
      case "activities": {
        const write: ActivityWriteInput = {
          title: String(staged.title ?? ""),
          customerPageId: String(staged.customerPageId ?? ""),
          dealPageId: (staged.dealPageId as string) ?? null,
          contactPageIds: (staged.contactPageIds as string[]) ?? [],
          activityAt: String(staged.activityAt ?? ""),
          categoryPageIds: (staged.categoryPageIds as string[]) ?? [],
          summary: (staged.summary as string) ?? null,
          nextActionNote: (staged.nextActionNote as string) ?? null,
          nextActionDate: (staged.nextActionDate as string) ?? null,
          body: String(staged.body ?? ""),
          batchId: input.importJobId,
        };
        if (isUpdate && pageId) {
          const result = await activityUpdate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            notionPageId: pageId,
            externalId,
            expectedLastEditedTime: await loadExpectedEdited(
              input.admin,
              "activity_index",
              pageId,
            ),
            input: write,
          });
          notionPageId = result.notionPageId;
        } else {
          const result = await activityCreate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            input: write,
            externalId,
          });
          notionPageId = result.notionPageId;
        }
        await requestCustomerLatestActivityRecalc({
          customerPageIds: [write.customerPageId],
        });
        break;
      }
      case "actions": {
        const write: ActionWriteInput = {
          title: String(staged.title ?? ""),
          customerPageId: String(staged.customerPageId ?? ""),
          dealPageId: (staged.dealPageId as string) ?? null,
          activityPageId: (staged.activityPageId as string) ?? null,
          staffPageId: (staged.staffPageId as string) ?? null,
          dueDate: String(staged.dueDate ?? ""),
          statusPageId: String(staged.statusPageId ?? ""),
          priorityPageId: (staged.priorityPageId as string) ?? null,
          completedAt: (staged.completedAt as string) ?? null,
        };
        if (isUpdate && pageId) {
          const result = await actionUpdate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            notionPageId: pageId,
            externalId,
            expectedLastEditedTime: await loadExpectedEdited(
              input.admin,
              "action_index",
              pageId,
            ),
            input: write,
          });
          notionPageId = result.notionPageId;
        } else {
          const result = await actionCreate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            input: write,
            externalId,
          });
          notionPageId = result.notionPageId;
        }
        await requestNextActionRecalc({
          customerPageIds: [write.customerPageId],
          dealPageIds: write.dealPageId ? [write.dealPageId] : [],
        });
        break;
      }
      case "contracts": {
        const write: ContractWriteInput = {
          title: String(staged.title ?? ""),
          customerPageId: String(staged.customerPageId ?? ""),
          dealPageId: (staged.dealPageId as string) ?? null,
          contractTypePageId: (staged.contractTypePageId as string) ?? null,
          tradeTypePageId: (staged.tradeTypePageId as string) ?? null,
          paymentStatusPageId: (staged.paymentStatusPageId as string) ?? null,
          statusPageId: (staged.statusPageId as string) ?? null,
          staffPageIds: (staged.staffPageIds as string[]) ?? [],
          amount: staged.amount == null ? null : Number(staged.amount),
          contractedAt: (staged.contractedAt as string) ?? null,
          startDate: (staged.startDate as string) ?? null,
          endDate: (staged.endDate as string) ?? null,
          autoRenew: Boolean(staged.autoRenew ?? false),
          billingTerms: (staged.billingTerms as string) ?? null,
          contractUrl: (staged.contractUrl as string) ?? null,
          note: (staged.note as string) ?? null,
        };
        if (isUpdate && pageId) {
          const result = await contractUpdate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            notionPageId: pageId,
            externalId,
            expectedLastEditedTime: await loadExpectedEdited(
              input.admin,
              "contract_index",
              pageId,
            ),
            input: write,
          });
          notionPageId = result.notionPageId;
        } else {
          const result = await contractCreate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            input: write,
            externalId,
          });
          notionPageId = result.notionPageId;
        }
        break;
      }
      case "complaints": {
        const write: ComplaintWriteInput = {
          title: String(staged.title ?? ""),
          customerPageId: String(staged.customerPageId ?? ""),
          dealPageId: (staged.dealPageId as string) ?? null,
          severityPageId: (staged.severityPageId as string) ?? null,
          statusPageId: (staged.statusPageId as string) ?? null,
          staffPageId: (staged.staffPageId as string) ?? null,
          occurredOn: (staged.occurredOn as string) ?? null,
          summary: (staged.summary as string) ?? null,
          dueDate: (staged.dueDate as string) ?? null,
          completedOn: (staged.completedOn as string) ?? null,
          note: (staged.note as string) ?? null,
          content: (staged.content as string) ?? null,
          cause: (staged.cause as string) ?? null,
          response: (staged.response as string) ?? null,
          prevention: (staged.prevention as string) ?? null,
        };
        if (isUpdate && pageId) {
          const result = await complaintUpdate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            notionPageId: pageId,
            externalId,
            expectedLastEditedTime: await loadExpectedEdited(
              input.admin,
              "complaint_index",
              pageId,
            ),
            input: write,
          });
          notionPageId = result.notionPageId;
        } else {
          const result = await complaintCreate({
            requestId,
            actorId: input.actorId,
            actorName: input.actorName,
            input: write,
            externalId,
          });
          notionPageId = result.notionPageId;
        }
        break;
      }
      default:
        return { ok: false, errorCode: "unknown_entity" };
    }

    await input.admin.from("audit_logs").insert({
      actor_id: input.actorId,
      actor_name: input.actorName,
      action: "import.row_imported",
      entity_type: input.entityType,
      notion_page_id: notionPageId,
      changed_fields: {
        import_job_id: input.importJobId,
        row_number: input.row.row_number,
        source_key_hash: null,
      },
      operation_source: "csv_import",
      request_id: requestId,
    } as never);

    return { ok: true, notionPageId, externalId };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: string }).code)
        : "import_failed";
    return { ok: false, errorCode: code.slice(0, 80), externalId };
  }
}
