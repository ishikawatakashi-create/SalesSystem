import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import type { CurrentRelations } from "@/lib/customers/validate-relations";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MastersCacheRow } from "@/types/database";

/**
 * 顧客フォームの選択肢。
 * - 新規選択肢: 有効マスタ / 有効app_users / 非アーカイブ顧客のみ
 * - 更新時: 現在値として維持している無効値・アーカイブ済み関連も含める(isActive=falseで返す)
 */

export type MasterOption = {
  pageId: string;
  name: string;
  isActive: boolean;
};

export type StaffOption = {
  pageId: string;
  name: string;
  isActive: boolean;
};

export type RelatedCustomerOption = {
  pageId: string;
  displayName: string;
  isArchived: boolean;
};

export type CustomerFormOptions = {
  businessCategories: MasterOption[];
  tags: MasterOption[];
  salesStatuses: MasterOption[];
  acquisitionRoutes: MasterOption[];
  priorities: MasterOption[];
  staff: StaffOption[];
  relatedCustomers: RelatedCustomerOption[];
};

const MASTER_TYPE_TO_KEY: Record<
  string,
  keyof Pick<
    CustomerFormOptions,
    | "businessCategories"
    | "tags"
    | "salesStatuses"
    | "acquisitionRoutes"
    | "priorities"
  >
> = {
  事業区分: "businessCategories",
  タグ: "tags",
  営業ステータス: "salesStatuses",
  集客ルート: "acquisitionRoutes",
  優先度: "priorities",
};

export async function loadCustomerFormOptions(input?: {
  current?: CurrentRelations;
  selfPageId?: string;
}): Promise<CustomerFormOptions> {
  const user = await requireUser();
  requirePermission(user, "customer.edit");

  const admin = createAdminClient();
  const current = input?.current;
  const currentMasterIds = new Set(
    current
      ? [
          ...current.businessCategoryPageIds,
          ...current.tagPageIds,
          ...(current.salesStatusPageId ? [current.salesStatusPageId] : []),
          ...(current.acquisitionRoutePageId
            ? [current.acquisitionRoutePageId]
            : []),
          ...(current.priorityPageId ? [current.priorityPageId] : []),
        ]
      : [],
  );
  const currentStaffIds = new Set(current?.staffPageIds ?? []);
  const currentRelatedIds = new Set(current?.relatedAccountPageIds ?? []);

  const [mastersRes, staffRes, customersRes] = await Promise.all([
    admin
      .from("masters_cache")
      .select("notion_page_id,master_type,name,sort_order,is_active")
      .in("master_type", Object.keys(MASTER_TYPE_TO_KEY))
      .order("sort_order", { ascending: true, nullsFirst: false }),
    admin
      .from("app_users")
      .select("notion_staff_page_id,display_name,is_active")
      .not("notion_staff_page_id", "is", null),
    admin
      .from("customer_index")
      .select("notion_page_id,display_name,is_archived")
      .order("display_name", { ascending: true })
      .limit(500),
  ]);
  for (const r of [mastersRes, staffRes, customersRes]) {
    if (r.error) {
      throw new Error(`フォーム選択肢の取得に失敗しました: ${r.error.message}`);
    }
  }

  const options: CustomerFormOptions = {
    businessCategories: [],
    tags: [],
    salesStatuses: [],
    acquisitionRoutes: [],
    priorities: [],
    staff: [],
    relatedCustomers: [],
  };

  for (const raw of (mastersRes.data ?? []) as Pick<
    MastersCacheRow,
    "notion_page_id" | "master_type" | "name" | "sort_order" | "is_active"
  >[]) {
    const key = MASTER_TYPE_TO_KEY[raw.master_type];
    if (!key) continue;
    // 新規選択肢は有効のみ。無効は現在値として維持中の場合のみ含める
    if (!raw.is_active && !currentMasterIds.has(raw.notion_page_id)) continue;
    options[key].push({
      pageId: raw.notion_page_id,
      name: raw.name,
      isActive: raw.is_active,
    });
  }

  for (const raw of (staffRes.data ?? []) as {
    notion_staff_page_id: string;
    display_name: string;
    is_active: boolean;
  }[]) {
    if (!raw.is_active && !currentStaffIds.has(raw.notion_staff_page_id)) {
      continue;
    }
    options.staff.push({
      pageId: raw.notion_staff_page_id,
      name: raw.display_name,
      isActive: raw.is_active,
    });
  }

  for (const raw of (customersRes.data ?? []) as {
    notion_page_id: string;
    display_name: string;
    is_archived: boolean;
  }[]) {
    if (input?.selfPageId && raw.notion_page_id === input.selfPageId) continue;
    if (raw.is_archived && !currentRelatedIds.has(raw.notion_page_id)) continue;
    options.relatedCustomers.push({
      pageId: raw.notion_page_id,
      displayName: raw.display_name,
      isArchived: raw.is_archived,
    });
  }

  return options;
}
