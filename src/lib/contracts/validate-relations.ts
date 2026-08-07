import type { ContractWriteInput } from "@/lib/contracts/types";
import { ContractSyncError } from "@/lib/sync/errors";
import type { SyncStatus } from "@/types/database";

/**
 * 契約relation検証。
 * 実行位置: Zod検証後・write_operations作成前・Notion API呼出前。
 */

export type ContractRelationValidationReason =
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

export const CONTRACT_MASTER_FIELDS = {
  contractTypePageId: "契約区分",
  tradeTypePageId: "取引区分",
  paymentStatusPageId: "支払状況",
  statusPageId: "契約状態",
} as const;

type MasterField = keyof typeof CONTRACT_MASTER_FIELDS;

const FIELD_LABELS: Record<string, string> = {
  customerPageId: "顧客アカウント",
  dealPageId: "関連案件",
  contractTypePageId: "契約区分",
  tradeTypePageId: "取引区分",
  paymentStatusPageId: "支払状況",
  statusPageId: "状態",
  staffPageIds: "担当者",
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

export type ContractRelationLookupData = {
  masters: MasterLookupRow[];
  staff: StaffLookupRow[];
  customers: CustomerLookupRow[];
  deals: DealLookupRow[];
};

export type ContractRelationLooseInput = Omit<
  ContractWriteInput,
  | "customerPageId"
  | "dealPageId"
  | "contractTypePageId"
  | "tradeTypePageId"
  | "paymentStatusPageId"
  | "statusPageId"
> & {
  customerPageId: string | string[] | null;
  dealPageId: string | string[] | null;
  contractTypePageId: string | string[] | null;
  tradeTypePageId: string | string[] | null;
  paymentStatusPageId: string | string[] | null;
  statusPageId: string | string[] | null;
};

export type CurrentContractRelations = {
  customerPageId: string | null;
  dealPageId: string | null;
  contractTypePageId: string | null;
  tradeTypePageId: string | null;
  paymentStatusPageId: string | null;
  statusPageId: string | null;
  staffPageIds: string[];
};

export type ContractRelationValidationContext = {
  current?: CurrentContractRelations;
};

function fail(
  reason: ContractRelationValidationReason,
  field: string,
): never {
  const label = FIELD_LABELS[field] ?? field;
  const messages: Record<ContractRelationValidationReason, string> = {
    relation_not_found: `${label}に存在しない選択肢が指定されています`,
    wrong_master_type: `${label}に別種別の選択肢が指定されています`,
    inactive_relation: `${label}に無効化された選択肢は新しく指定できません`,
    too_many_relations: `${label}は1件のみ指定できます`,
    invalid_staff: `担当者に不明な担当者が指定されています`,
    invalid_customer_relation: `${label}に指定できない顧客が含まれています`,
    archived_customer_forbidden: `アーカイブ済みの顧客へは新規に契約を設定できません`,
    missing_required_relation: `${label}は必須です`,
    invalid_deal_relation: `関連案件に存在しない案件が指定されています`,
    deal_customer_mismatch: `関連案件は選択中の顧客に所属している必要があります`,
  };
  throw new ContractSyncError("validation", messages[reason], {
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

export function collectContractRelationIds(input: ContractRelationLooseInput): {
  masterIds: string[];
  staffPageIds: string[];
  customerPageIds: string[];
  dealPageIds: string[];
} {
  const single = (v: string | string[] | null): string[] =>
    v === null ? [] : typeof v === "string" ? (v ? [v] : []) : v.filter(Boolean);
  return {
    masterIds: dedupe([
      ...single(input.contractTypePageId),
      ...single(input.tradeTypePageId),
      ...single(input.paymentStatusPageId),
      ...single(input.statusPageId),
    ]),
    staffPageIds: dedupe(input.staffPageIds),
    customerPageIds: dedupe(single(input.customerPageId)),
    dealPageIds: dedupe(single(input.dealPageId)),
  };
}

export async function loadContractRelationLookup(
  db: { from(table: string): any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  ids: {
    masterIds: string[];
    staffPageIds: string[];
    customerPageIds: string[];
    dealPageIds: string[];
  },
): Promise<ContractRelationLookupData> {
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

export function validateContractRelations(input: {
  write: ContractRelationLooseInput;
  lookup: ContractRelationLookupData;
  context?: ContractRelationValidationContext;
}): ContractWriteInput {
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
    Boolean(current?.staffPageIds?.includes(id));

  const checkMaster = (field: MasterField, id: string) => {
    const row = mastersById.get(id);
    if (!row) fail("relation_not_found", field);
    if (row.master_type !== CONTRACT_MASTER_FIELDS[field]) {
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

  const contractTypePageId = normalizeSingle(
    write.contractTypePageId,
    "contractTypePageId",
  );
  if (contractTypePageId) {
    checkMaster("contractTypePageId", contractTypePageId);
  }

  const tradeTypePageId = normalizeSingle(
    write.tradeTypePageId,
    "tradeTypePageId",
  );
  if (tradeTypePageId) checkMaster("tradeTypePageId", tradeTypePageId);

  const paymentStatusPageId = normalizeSingle(
    write.paymentStatusPageId,
    "paymentStatusPageId",
  );
  if (paymentStatusPageId) {
    checkMaster("paymentStatusPageId", paymentStatusPageId);
  }

  const statusPageId = normalizeSingle(write.statusPageId, "statusPageId");
  if (statusPageId) checkMaster("statusPageId", statusPageId);

  const staffPageIds = dedupe(write.staffPageIds);
  for (const id of staffPageIds) {
    const row = staffByPageId.get(id);
    if (!row) fail("invalid_staff", "staffPageIds");
    if (!row.is_active && !isRetainedStaff(id)) {
      fail("inactive_relation", "staffPageIds");
    }
  }

  return {
    ...write,
    customerPageId,
    dealPageId,
    contractTypePageId,
    tradeTypePageId,
    paymentStatusPageId,
    statusPageId,
    staffPageIds,
  };
}
