import "server-only";

import type { Client } from "@notionhq/client";

import { newRequestId } from "@/lib/notion/ids";
import { logNotionError, logNotionInfo } from "@/lib/notion/logger";
import { staffExternalId } from "@/lib/notion/provisioning/staff-id";
import { createAdminClient } from "@/lib/supabase/admin";

export { staffExternalId } from "@/lib/notion/provisioning/staff-id";

export type StaffProvisionInput = {
  userId: string;
  displayName: string;
  role: string;
  departmentRole: string | null;
  isActive: boolean;
  email: string;
};

/**
 * profile_createdのユーザーを自社担当者DBへ同期し、成功後にcompletedへ。
 * Notion成功前にcompletedへしない。冪等(external_id=app_users.id由来)。
 * dryRun時は実際の管理者ページ作成を行わない。
 */
export async function provisionStaffPage(input: {
  notion: Client;
  staffDataSourceId: string;
  user: StaffProvisionInput;
  dryRun?: boolean;
}): Promise<{ status: "completed" | "dry_run" | "failed"; pageId?: string }> {
  const requestId = newRequestId();
  const externalId = staffExternalId(input.user.userId);
  const admin = createAdminClient();

  if (input.dryRun) {
    logNotionInfo({
      request_id: requestId,
      message: "staff_provision_dry_run",
    });
    return { status: "dry_run" };
  }

  try {
    const existing = await input.notion.dataSources.query({
      data_source_id: input.staffDataSourceId,
      filter: {
        property: "external_id",
        rich_text: { equals: externalId },
      },
      page_size: 1,
    } as never);
    const results = (existing as { results: Array<{ id: string }> }).results;
    let pageId = results[0]?.id;

    if (!pageId) {
      const created = await input.notion.pages.create({
        parent: {
          type: "data_source_id",
          data_source_id: input.staffDataSourceId,
        },
        properties: {
          氏名: {
            title: [{ text: { content: input.user.displayName } }],
          },
          external_id: {
            rich_text: [{ text: { content: externalId } }],
          },
          メールアドレス: { email: input.user.email },
          ロール: {
            rich_text: [{ text: { content: input.user.role } }],
          },
          "所属・役割": {
            rich_text: [
              {
                text: { content: input.user.departmentRole ?? "" },
              },
            ],
          },
          有効: { checkbox: input.user.isActive },
        },
      } as never);
      pageId = (created as { id: string }).id;
    }

    const { error } = await admin
      .from("app_users")
      .update({
        notion_staff_page_id: pageId,
        provisioning_status: "completed",
        provisioning_error: null,
      })
      .eq("id", input.user.userId)
      .eq("provisioning_status", "profile_created");

    if (error) {
      throw new Error(error.message);
    }

    logNotionInfo({
      request_id: requestId,
      message: "staff_provision_completed",
    });
    return { status: "completed", pageId };
  } catch (error) {
    logNotionError({
      request_id: requestId,
      message: "staff_provision_failed",
    });
    await admin.from("sync_errors").insert({
      stage: "user_provisioning",
      entity_type: "staff",
      external_id: externalId,
      message: "自社担当者ページの同期に失敗しました",
      detail: { user_id: input.user.userId },
    });
    await admin
      .from("app_users")
      .update({
        provisioning_status: "failed",
        provisioning_error: "staff_provision_failed",
      })
      .eq("id", input.user.userId);
    void error;
    return { status: "failed" };
  }
}
