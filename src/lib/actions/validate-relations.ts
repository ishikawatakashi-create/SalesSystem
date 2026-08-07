import type { ActionWriteInput } from "@/lib/actions/types";
import { ActionSyncError } from "@/lib/sync/errors";
import type { SyncStatus } from "@/types/database";

export type ActionRelationValidationReason =
  | "relation_not_found"
  | "wrong_master_type"
  | "inactive_relation"
  | "too_many_relations"
  | "invalid_staff"
  | "invalid_customer_relation"
  | "archived_customer_forbidden"
  | "missing_required_relation"
  | "invalid_deal_relation"
  | "deal_customer_mismatch"
  | "invalid_activity_relation"
  | "activity_customer_mismatch";

const FIELD_LABELS: Record<string, string> = {
  customerPageId: "顧客アカウント",
  dealPageId: "案件",
  activityPageId: "元対応履歴",
  staffPageId: "自社担当者",
  statusPageId: "状態",
  priorityPageId: "優先度",
};

export type MasterLookupRow = {
  notion_page_id: string;
  master_type: string;
  is_active: boolean;
};

export type StaffLookupRow = {
  notion_staff_page_id: string;
  is_active: boolean;
};

export type CustomerLookupRow = {
  notion_page_id: string;
  is_archived: boolean;
  sync_status: SyncStatus;
};

export type DealLookupRow = {
  notion_page_id: string;
  customer_page_id: string | null;
};

export type ActivityLookupRow = {
  notion_page_id: string;
  customer_page_id: string | null;
};

export type ActionRelationLookupData = {
  masters: MasterLookupRow[];
  staff: StaffLookupRow[];
  customers: CustomerLookupRow[];
  deals: DealLookupRow[];
  activities: ActivityLookupRow[];
};

export type ActionRelationLooseInput = Omit<
  ActionWriteInput,
  | "customerPageId"
  | "dealPageId"
  | "activityPageId"
  | "staffPageId"
  | "statusPageId"
  | "priorityPageId"
> & {
  customerPageId: string | string[] | null;
  dealPageId: string | string[] | null;
  activityPageId: string | string[] | null;
  staffPageId: string | string[] | null;
  statusPageId: string | string[] | null;
  priorityPageId: string | string[] | null;
};

export type CurrentActionRelations = {
  customerPageId: string | null;
  dealPageId: string | null;
  activityPageId: string | null;
  staffPageId: string | null;
  statusPageId: string | null;
  priorityPageId: string | null;
};

export type ActionRelationValidationContext = {
  current?: CurrentActionRelations;
};

function fail(
  reason: ActionRelationValidationReason,
  field: string,
): never {
  const label = FIELD_LABELS[field] ?? field;
  const messages: Record<ActionRelationValidationReason, string> = {
    relation_not_found: `${label}に存在しない選択肢が指定されています`,
    wrong_master_type: `${label}に別種別の選択肢が指定されています`,
    inactive_relation: `${label}に無効化された選択肢は新しく指定できません`,
    too_many_relations: `${label}は1件のみ指定できます`,
    invalid_staff: `自社担当者に不明な担当者が指定されています`,
    invalid_customer_relation: `${label}に指定できない顧客が含まれています`,
    archived_customer_forbidden: `アーカイブ済みの顧客へは新規にアクションを設定できません`,
    missing_required_relation: `${label}は必須です`,
    invalid_deal_relation: `案件に存在しない案件が指定されています`,
    deal_customer_mismatch: `案件は選択中の顧客に所属している必要があります`,
    invalid_activity_relation: `元対応履歴に存在しない履歴が指定されています`,
    activity_customer_mismatch: `元対応履歴は選択中の顧客に所属している必要があります`,
  };
  throw new ActionSyncError("validation", messages[reason], {
    reason,
    field,
  });
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

function normalizeSingle(
  value: string | string[] | null,
  field: string,
): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value || null;
  const unique = dedupe(value.filter(Boolean));
  if (unique.length === 0) return null;
  if (unique.length > 1) fail("too_many_relations", field);
  return unique[0]!;
}

export function collectActionRelationIds(input: ActionRelationLooseInput): {
  masterIds: string[];
  staffPageIds: string[];
  customerPageIds: string[];
  dealPageIds: string[];
  activityPageIds: string[];
} {
  const single = (v: string | string[] | null): string[] =>
    v === null ? [] : typeof v === "string" ? (v ? [v] : []) : v.filter(Boolean);
  return {
    masterIds: dedupe([
      ...single(input.statusPageId),
      ...single(input.priorityPageId),
    ]),
    staffPageIds: dedupe(single(input.staffPageId)),
    customerPageIds: dedupe(single(input.customerPageId)),
    dealPageIds: dedupe(single(input.dealPageId)),
    activityPageIds: dedupe(single(input.activityPageId)),
  };
}

export async function loadActionRelationLookup(
  db: { from(table: string): any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  ids: {
    masterIds: string[];
    staffPageIds: string[];
    customerPageIds: string[];
    dealPageIds: string[];
    activityPageIds: string[];
  },
): Promise<ActionRelationLookupData> {
  const [masters, staff, customers, deals, activities] = await Promise.all([
    ids.masterIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("masters_cache")
          .select("notion_page_id,master_type,is_active")
          .in("notion_page_id", ids.masterIds),
    ids.staffPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("app_users")
          .select("notion_staff_page_id,is_active")
          .in("notion_staff_page_id", ids.staffPageIds),
    ids.customerPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("customer_index")
          .select("notion_page_id,is_archived,sync_status")
          .in("notion_page_id", ids.customerPageIds),
    ids.dealPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("deal_index")
          .select("notion_page_id,customer_page_id")
          .in("notion_page_id", ids.dealPageIds),
    ids.activityPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("activity_index")
          .select("notion_page_id,customer_page_id")
          .in("notion_page_id", ids.activityPageIds),
  ]);
  for (const r of [masters, staff, customers, deals, activities]) {
    if (r.error) {
      throw new Error(`relation lookupに失敗しました: ${r.error.message}`);
    }
  }
  return {
    masters: (masters.data ?? []) as MasterLookupRow[],
    staff: (staff.data ?? []) as StaffLookupRow[],
    customers: (customers.data ?? []) as CustomerLookupRow[],
    deals: (deals.data ?? []) as DealLookupRow[],
    activities: (activities.data ?? []) as ActivityLookupRow[],
  };
}

export function validateActionRelations(input: {
  write: ActionRelationLooseInput;
  lookup: ActionRelationLookupData;
  context?: ActionRelationValidationContext;
}): ActionWriteInput {
  const { write, lookup, context } = input;
  const current = context?.current;

  const mastersById = new Map(
    lookup.masters.map((m) => [m.notion_page_id, m]),
  );
  const staffByPageId = new Map(
    lookup.staff.map((s) => [s.notion_staff_page_id, s]),
  );
  const customersById = new Map(
    lookup.customers.map((c) => [c.notion_page_id, c]),
  );
  const dealsById = new Map(lookup.deals.map((d) => [d.notion_page_id, d]));
  const activitiesById = new Map(
    lookup.activities.map((a) => [a.notion_page_id, a]),
  );

  const isRetained = (
    field: keyof CurrentActionRelations,
    id: string,
  ): boolean => Boolean(current?.[field] && current[field] === id);

  const customerPageId = normalizeSingle(
    write.customerPageId,
    "customerPageId",
  );
  if (!customerPageId) {
    fail("missing_required_relation", "customerPageId");
  }

  const customer = customersById.get(customerPageId);
  if (!customer) {
    fail("invalid_customer_relation", "customerPageId");
  }
  if (!isRetained("customerPageId", customerPageId)) {
    if (customer.is_archived) {
      fail("archived_customer_forbidden", "customerPageId");
    }
    if (
      customer.sync_status === "delete_pending" ||
      customer.sync_status === "excluded"
    ) {
      fail("invalid_customer_relation", "customerPageId");
    }
  }

  const dealPageId = normalizeSingle(write.dealPageId, "dealPageId");
  if (dealPageId) {
    const deal = dealsById.get(dealPageId);
    if (!deal) fail("invalid_deal_relation", "dealPageId");
    if (deal.customer_page_id !== customerPageId) {
      fail("deal_customer_mismatch", "dealPageId");
    }
  }

  const activityPageId = normalizeSingle(
    write.activityPageId,
    "activityPageId",
  );
  if (activityPageId) {
    const activity = activitiesById.get(activityPageId);
    if (!activity) fail("invalid_activity_relation", "activityPageId");
    if (activity.customer_page_id !== customerPageId) {
      fail("activity_customer_mismatch", "activityPageId");
    }
  }

  const staffPageId = normalizeSingle(write.staffPageId, "staffPageId");
  if (staffPageId) {
    const row = staffByPageId.get(staffPageId);
    if (!row) fail("invalid_staff", "staffPageId");
    if (!row.is_active && !isRetained("staffPageId", staffPageId)) {
      fail("inactive_relation", "staffPageId");
    }
  }

  const statusPageId = normalizeSingle(write.statusPageId, "statusPageId");
  if (!statusPageId) {
    fail("missing_required_relation", "statusPageId");
  }
  {
    const row = mastersById.get(statusPageId);
    if (!row) fail("relation_not_found", "statusPageId");
    if (row.master_type !== "アクション状態") {
      fail("wrong_master_type", "statusPageId");
    }
    if (!row.is_active && !isRetained("statusPageId", statusPageId)) {
      fail("inactive_relation", "statusPageId");
    }
  }

  const priorityPageId = normalizeSingle(
    write.priorityPageId,
    "priorityPageId",
  );
  if (priorityPageId) {
    const row = mastersById.get(priorityPageId);
    if (!row) fail("relation_not_found", "priorityPageId");
    if (row.master_type !== "優先度") {
      fail("wrong_master_type", "priorityPageId");
    }
    if (!row.is_active && !isRetained("priorityPageId", priorityPageId)) {
      fail("inactive_relation", "priorityPageId");
    }
  }

  return {
    ...write,
    customerPageId,
    dealPageId,
    activityPageId,
    staffPageId,
    statusPageId,
    priorityPageId,
  };
}
