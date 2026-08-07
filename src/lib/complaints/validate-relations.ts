import type { ComplaintWriteInput } from "@/lib/complaints/types";
import { ComplaintSyncError } from "@/lib/sync/errors";
import type { SyncStatus } from "@/types/database";

export type ComplaintRelationValidationReason =
  | "relation_not_found"
  | "wrong_master_type"
  | "inactive_relation"
  | "too_many_relations"
  | "invalid_staff"
  | "invalid_customer_relation"
  | "archived_customer_forbidden"
  | "missing_required_relation"
  | "invalid_deal_relation"
  | "deal_customer_mismatch";

export const COMPLAINT_MASTER_FIELDS = {
  severityPageId: "クレーム重要度",
  statusPageId: "クレーム対応状況",
} as const;

type MasterField = keyof typeof COMPLAINT_MASTER_FIELDS;

const FIELD_LABELS: Record<string, string> = {
  customerPageId: "顧客アカウント",
  dealPageId: "関連案件",
  severityPageId: "重要度",
  statusPageId: "対応状況",
  staffPageId: "対応責任者",
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

export type ComplaintRelationLookupData = {
  masters: MasterLookupRow[];
  staff: StaffLookupRow[];
  customers: CustomerLookupRow[];
  deals: DealLookupRow[];
};

export type ComplaintRelationLooseInput = Omit<
  ComplaintWriteInput,
  | "customerPageId"
  | "dealPageId"
  | "severityPageId"
  | "statusPageId"
  | "staffPageId"
> & {
  customerPageId: string | string[] | null;
  dealPageId: string | string[] | null;
  severityPageId: string | string[] | null;
  statusPageId: string | string[] | null;
  staffPageId: string | string[] | null;
};

export type CurrentComplaintRelations = {
  customerPageId: string | null;
  dealPageId: string | null;
  severityPageId: string | null;
  statusPageId: string | null;
  staffPageId: string | null;
};

export type ComplaintRelationValidationContext = {
  current?: CurrentComplaintRelations;
};

function fail(
  reason: ComplaintRelationValidationReason,
  field: string,
): never {
  const label = FIELD_LABELS[field] ?? field;
  const messages: Record<ComplaintRelationValidationReason, string> = {
    relation_not_found: `${label}に存在しない選択肢が指定されています`,
    wrong_master_type: `${label}に別種別の選択肢が指定されています`,
    inactive_relation: `${label}に無効化された選択肢は新しく指定できません`,
    too_many_relations: `${label}は1件のみ指定できます`,
    invalid_staff: `対応責任者に不明な担当者が指定されています`,
    invalid_customer_relation: `${label}に指定できない顧客が含まれています`,
    archived_customer_forbidden: `アーカイブ済みの顧客へは新規にクレームを設定できません`,
    missing_required_relation: `${label}は必須です`,
    invalid_deal_relation: `関連案件に存在しない案件が指定されています`,
    deal_customer_mismatch: `関連案件は選択中の顧客に所属している必要があります`,
  };
  throw new ComplaintSyncError("validation", messages[reason], {
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

export function collectComplaintRelationIds(
  input: ComplaintRelationLooseInput,
): {
  masterIds: string[];
  staffPageIds: string[];
  customerPageIds: string[];
  dealPageIds: string[];
} {
  const single = (v: string | string[] | null): string[] =>
    v === null ? [] : typeof v === "string" ? (v ? [v] : []) : v.filter(Boolean);
  return {
    masterIds: dedupe([
      ...single(input.severityPageId),
      ...single(input.statusPageId),
    ]),
    staffPageIds: dedupe(single(input.staffPageId)),
    customerPageIds: dedupe(single(input.customerPageId)),
    dealPageIds: dedupe(single(input.dealPageId)),
  };
}

export async function loadComplaintRelationLookup(
  db: { from(table: string): any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  ids: {
    masterIds: string[];
    staffPageIds: string[];
    customerPageIds: string[];
    dealPageIds: string[];
  },
): Promise<ComplaintRelationLookupData> {
  const [masters, staff, customers, deals] = await Promise.all([
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
  ]);
  for (const r of [masters, staff, customers, deals]) {
    if (r.error) {
      throw new Error(`relation lookupに失敗しました: ${r.error.message}`);
    }
  }
  return {
    masters: (masters.data ?? []) as MasterLookupRow[],
    staff: (staff.data ?? []) as StaffLookupRow[],
    customers: (customers.data ?? []) as CustomerLookupRow[],
    deals: (deals.data ?? []) as DealLookupRow[],
  };
}

export function validateComplaintRelations(input: {
  write: ComplaintRelationLooseInput;
  lookup: ComplaintRelationLookupData;
  context?: ComplaintRelationValidationContext;
}): ComplaintWriteInput {
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

  const isRetainedMaster = (field: MasterField, id: string): boolean =>
    Boolean(current?.[field] && current[field] === id);

  const isRetainedCustomer = (id: string): boolean =>
    Boolean(current?.customerPageId && current.customerPageId === id);

  const isRetainedStaff = (id: string): boolean =>
    Boolean(current?.staffPageId && current.staffPageId === id);

  const checkMaster = (field: MasterField, id: string) => {
    const row = mastersById.get(id);
    if (!row) fail("relation_not_found", field);
    if (row.master_type !== COMPLAINT_MASTER_FIELDS[field]) {
      fail("wrong_master_type", field);
    }
    if (!row.is_active && !isRetainedMaster(field, id)) {
      fail("inactive_relation", field);
    }
  };

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
  const retainedCustomer = isRetainedCustomer(customerPageId);
  if (!retainedCustomer) {
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

  const severityPageId = normalizeSingle(
    write.severityPageId,
    "severityPageId",
  );
  if (severityPageId) checkMaster("severityPageId", severityPageId);

  const statusPageId = normalizeSingle(write.statusPageId, "statusPageId");
  if (statusPageId) checkMaster("statusPageId", statusPageId);

  const staffPageId = normalizeSingle(write.staffPageId, "staffPageId");
  if (staffPageId) {
    const row = staffByPageId.get(staffPageId);
    if (!row) fail("invalid_staff", "staffPageId");
    if (!row.is_active && !isRetainedStaff(staffPageId)) {
      fail("inactive_relation", "staffPageId");
    }
  }

  return {
    ...write,
    customerPageId,
    dealPageId,
    severityPageId,
    statusPageId,
    staffPageId,
  };
}
