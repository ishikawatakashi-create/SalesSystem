"use server";

import { revalidatePath } from "next/cache";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InquiryStatus } from "@/lib/inquiries/types";
import { createCustomerAction } from "@/features/customers/actions";
import { createContactAction } from "@/features/contacts/actions";
import { createActivityAction } from "@/features/activities/actions";

type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

async function auditInquiry(input: {
  action: string;
  actorId: string;
  actorName: string;
  inquiryId: string;
  changed: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  await admin.from("audit_logs").insert({
    action: input.action,
    entity_type: "inquiry",
    notion_page_id: null,
    actor_id: input.actorId,
    actor_name: input.actorName,
    changed_fields: {
      inquiry_id: input.inquiryId,
      ...input.changed,
    },
    operation_source: "ui",
    request_id: null,
    batch_id: null,
  });
}

function toFailure(error: unknown): ActionResult {
  if (error instanceof AuthError) {
    return { ok: false, message: "権限がありません" };
  }
  return { ok: false, message: "操作に失敗しました" };
}

export async function assignInquiryAction(input: {
  inquiryId: string;
  userId: string | null;
}): Promise<ActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "inquiry.edit");
    const admin = createAdminClient();
    const { data: before } = await admin
      .from("inquiries")
      .select("status,assigned_user_id")
      .eq("id", input.inquiryId)
      .maybeSingle();
    if (!before) return { ok: false, message: "お問い合わせが見つかりません" };

    let nextStatus: InquiryStatus = before.status as InquiryStatus;
    if (input.userId && before.status === "new") {
      nextStatus = "in_progress";
    }

    const { error } = await admin
      .from("inquiries")
      .update({
        assigned_user_id: input.userId,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.inquiryId);
    if (error) return { ok: false, message: "担当の更新に失敗しました" };

    await auditInquiry({
      action: "inquiry.assigned",
      actorId: user.id,
      actorName: user.display_name,
      inquiryId: input.inquiryId,
      changed: {
        assigned_user_id: input.userId,
        status: nextStatus,
        previous_status: before.status,
        previous_assigned_user_id: before.assigned_user_id,
      },
    });
    if (nextStatus !== before.status) {
      await auditInquiry({
        action: "inquiry.status_changed",
        actorId: user.id,
        actorName: user.display_name,
        inquiryId: input.inquiryId,
        changed: { status: nextStatus, previous_status: before.status },
      });
    }
    revalidatePath("/inquiries");
    revalidatePath(`/inquiries/${input.inquiryId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return toFailure(e);
  }
}

export async function setInquiryStatusAction(input: {
  inquiryId: string;
  status: InquiryStatus;
  noActionReason?: string | null;
}): Promise<ActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "inquiry.edit");
    const admin = createAdminClient();
    const { data: before } = await admin
      .from("inquiries")
      .select("status")
      .eq("id", input.inquiryId)
      .maybeSingle();
    if (!before) return { ok: false, message: "お問い合わせが見つかりません" };

    const handledAt =
      input.status === "done" || input.status === "no_action"
        ? new Date().toISOString()
        : null;

    const { error } = await admin
      .from("inquiries")
      .update({
        status: input.status,
        no_action_reason:
          input.status === "no_action" ? input.noActionReason ?? null : null,
        handled_at: handledAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.inquiryId);
    if (error) return { ok: false, message: "状態の更新に失敗しました" };

    await auditInquiry({
      action: "inquiry.status_changed",
      actorId: user.id,
      actorName: user.display_name,
      inquiryId: input.inquiryId,
      changed: {
        status: input.status,
        previous_status: before.status,
        no_action_reason:
          input.status === "no_action" ? input.noActionReason ?? null : null,
      },
    });
    revalidatePath("/inquiries");
    revalidatePath(`/inquiries/${input.inquiryId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return toFailure(e);
  }
}

export async function linkInquiryCustomerAction(input: {
  inquiryId: string;
  customerPageId: string;
  contactPageId?: string | null;
}): Promise<ActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "inquiry.edit");
    const admin = createAdminClient();
    const { error } = await admin
      .from("inquiries")
      .update({
        linked_customer_page_id: input.customerPageId,
        linked_contact_page_id: input.contactPageId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.inquiryId);
    if (error) return { ok: false, message: "紐付けに失敗しました" };

    await auditInquiry({
      action: "inquiry.linked_customer",
      actorId: user.id,
      actorName: user.display_name,
      inquiryId: input.inquiryId,
      changed: {
        linked_customer_page_id: input.customerPageId,
        linked_contact_page_id: input.contactPageId ?? null,
      },
    });
    revalidatePath(`/inquiries/${input.inquiryId}`);
    return { ok: true };
  } catch (e) {
    return toFailure(e);
  }
}

export async function createCustomerFromInquiryAction(input: {
  inquiryId: string;
  requestId: string;
  data: unknown;
}): Promise<ActionResult & { notionPageId?: string }> {
  try {
    const user = await requireUser();
    requirePermission(user, "inquiry.edit");
    requirePermission(user, "customer.edit");
    const admin = createAdminClient();
    const { data: inquiry } = await admin
      .from("inquiries")
      .select("linked_customer_page_id")
      .eq("id", input.inquiryId)
      .maybeSingle();
    if (!inquiry) return { ok: false, message: "お問い合わせが見つかりません" };
    if (inquiry.linked_customer_page_id) {
      return {
        ok: true,
        message: "顧客は既に紐付いています",
        notionPageId: inquiry.linked_customer_page_id,
      };
    }

    const created = await createCustomerAction({
      requestId: input.requestId,
      data: input.data,
    });
    if (!created.ok) {
      return { ok: false, message: created.message };
    }
    await admin
      .from("inquiries")
      .update({
        linked_customer_page_id: created.notionPageId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.inquiryId);
    await auditInquiry({
      action: "inquiry.linked_customer",
      actorId: user.id,
      actorName: user.display_name,
      inquiryId: input.inquiryId,
      changed: {
        linked_customer_page_id: created.notionPageId,
        via: "create",
      },
    });
    revalidatePath(`/inquiries/${input.inquiryId}`);
    return { ok: true, notionPageId: created.notionPageId };
  } catch (e) {
    return toFailure(e);
  }
}

export async function createContactFromInquiryAction(input: {
  inquiryId: string;
  requestId: string;
  data: unknown;
}): Promise<ActionResult & { notionPageId?: string }> {
  try {
    const user = await requireUser();
    requirePermission(user, "inquiry.edit");
    requirePermission(user, "contact.edit");
    const admin = createAdminClient();
    const { data: inquiry } = await admin
      .from("inquiries")
      .select("linked_customer_page_id,linked_contact_page_id")
      .eq("id", input.inquiryId)
      .maybeSingle();
    if (!inquiry) return { ok: false, message: "お問い合わせが見つかりません" };
    if (!inquiry.linked_customer_page_id) {
      return { ok: false, message: "先に顧客を紐付けてください" };
    }
    if (inquiry.linked_contact_page_id) {
      return {
        ok: true,
        message: "担当者は既に紐付いています",
        notionPageId: inquiry.linked_contact_page_id,
      };
    }

    const created = await createContactAction({
      requestId: input.requestId,
      data: input.data,
    });
    if (!created.ok) {
      return {
        ok: false,
        message: `顧客は紐付け済みです。担当者作成に失敗: ${created.message}`,
      };
    }
    await admin
      .from("inquiries")
      .update({
        linked_contact_page_id: created.notionPageId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.inquiryId);
    await auditInquiry({
      action: "inquiry.linked_contact",
      actorId: user.id,
      actorName: user.display_name,
      inquiryId: input.inquiryId,
      changed: {
        linked_contact_page_id: created.notionPageId,
        via: "create",
      },
    });
    revalidatePath(`/inquiries/${input.inquiryId}`);
    return { ok: true, notionPageId: created.notionPageId };
  } catch (e) {
    return toFailure(e);
  }
}

export async function listInquiryDraftFromAliasesAction(): Promise<
  | { ok: true; aliases: string[]; primary: string | null }
  | { ok: false; message: string }
> {
  try {
    const user = await requireUser();
    requirePermission(user, "inquiry.edit");
    const { fetchDraftFromAliases } = await import(
      "@/lib/inquiries/apps-script-draft-client"
    );
    return fetchDraftFromAliases();
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, message: "権限がありません" };
    }
    return { ok: false, message: "送信元一覧の取得に失敗しました" };
  }
}

export async function createInquiryReplyDraftAction(input: {
  inquiryId: string;
  fromAddress: string;
  requestId: string;
}): Promise<ActionResult> {
  try {
    const user = await requireUser();
    requirePermission(user, "inquiry.edit");
    const admin = createAdminClient();
    const { data: inquiry } = await admin
      .from("inquiries")
      .select(
        "id,source_message_id,subject,sender_name,company_name,message_text,status,assigned_user_id,ingest_classification",
      )
      .eq("id", input.inquiryId)
      .maybeSingle();
    if (!inquiry) return { ok: false, message: "お問い合わせが見つかりません" };
    if (inquiry.ingest_classification !== "source") {
      return { ok: false, message: "この問い合わせでは下書きを作成できません" };
    }
    if (!inquiry.source_message_id) {
      return { ok: false, message: "元メールIDがありません" };
    }

    const requestId = input.requestId.trim();
    if (!requestId || requestId.length > 120) {
      return { ok: false, message: "リクエストが不正です" };
    }

    // 短時間の連打抑制（同一 inquiry）
    const since = new Date(Date.now() - 15_000).toISOString();
    const { count } = await admin
      .from("inquiry_draft_requests")
      .select("id", { count: "exact", head: true })
      .eq("inquiry_id", inquiry.id)
      .gte("created_at", since);
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        message: "短時間に複数回作成されています。しばらく待ってください",
      };
    }

    // request_id 一意（連打対策）
    const { error: reqInsErr } = await admin.from("inquiry_draft_requests").insert({
      inquiry_id: inquiry.id,
      draft_request_id: requestId,
      from_alias: input.fromAddress,
      created_by: user.id,
    });
    if (reqInsErr) {
      if (reqInsErr.code === "23505") {
        return { ok: false, message: "同じ操作が処理中または完了済みです" };
      }
      return { ok: false, message: "下書き要求の記録に失敗しました" };
    }

    const {
      buildInquiryReplyDraftBody,
    } = await import("@/lib/inquiries/reply-template");
    const { createGmailReplyDraft } = await import(
      "@/lib/inquiries/apps-script-draft-client"
    );

    const body = buildInquiryReplyDraftBody({
      companyName: inquiry.company_name,
      senderName: inquiry.sender_name,
      actorDisplayName: user.display_name,
      messageText: inquiry.message_text,
    });

    const created = await createGmailReplyDraft({
      gmailMessageId: inquiry.source_message_id,
      fromAddress: input.fromAddress,
      body,
      requestId,
    });
    if (!created.ok) {
      return { ok: false, message: created.message };
    }

    await auditInquiry({
      action: "inquiry.reply_draft_created",
      actorId: user.id,
      actorName: user.display_name,
      inquiryId: inquiry.id,
      changed: {
        draft_request_id: requestId,
        from_alias_set: true,
        // 本文は入れない
      },
    });

    revalidatePath(`/inquiries/${input.inquiryId}`);
    revalidatePath("/inquiries");
    return { ok: true, message: "Gmailに返信下書きを作成しました" };
  } catch (e) {
    return toFailure(e);
  }
}

export async function convertInquiryToActivityAction(input: {
  inquiryId: string;
  requestId: string;
  categoryPageIds?: string[];
}): Promise<ActionResult & { notionPageId?: string }> {
  try {
    const user = await requireUser();
    requirePermission(user, "inquiry.edit");
    requirePermission(user, "activity.edit");
    const admin = createAdminClient();
    const { data: inquiry } = await admin
      .from("inquiries")
      .select("*")
      .eq("id", input.inquiryId)
      .maybeSingle();
    if (!inquiry) return { ok: false, message: "お問い合わせが見つかりません" };
    if (!inquiry.linked_customer_page_id) {
      return { ok: false, message: "顧客の紐付けが必要です" };
    }
    if (inquiry.linked_activity_page_id) {
      return {
        ok: true,
        message: "対応履歴は既に作成済みです",
        notionPageId: inquiry.linked_activity_page_id,
      };
    }

    const subject = inquiry.subject?.trim() || "Webお問い合わせ";
    const title = `Webお問い合わせ：${subject}`.slice(0, 80);
    const body =
      inquiry.message_text?.trim() ||
      subject ||
      "(お問い合わせ本文なし)";

    const created = await createActivityAction({
      requestId: input.requestId,
      data: {
        title,
        customerPageId: inquiry.linked_customer_page_id,
        dealPageId: null,
        contactPageIds: inquiry.linked_contact_page_id
          ? [inquiry.linked_contact_page_id]
          : [],
        activityAt: inquiry.received_at,
        categoryPageIds: input.categoryPageIds ?? [],
        summary: null,
        nextActionNote: null,
        nextActionDate: null,
        body,
        batchId: null,
      },
    });
    if (!created.ok) {
      return { ok: false, message: created.message };
    }

    await admin
      .from("inquiries")
      .update({
        linked_activity_page_id: created.notionPageId,
        status: "done",
        handled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.inquiryId);

    await auditInquiry({
      action: "inquiry.converted_to_activity",
      actorId: user.id,
      actorName: user.display_name,
      inquiryId: input.inquiryId,
      changed: {
        linked_activity_page_id: created.notionPageId,
        status: "done",
      },
    });
    revalidatePath(`/inquiries/${input.inquiryId}`);
    revalidatePath("/inquiries");
    return { ok: true, notionPageId: created.notionPageId };
  } catch (e) {
    return toFailure(e);
  }
}
