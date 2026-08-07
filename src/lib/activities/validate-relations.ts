import type { ActivityWriteInput } from "@/lib/activities/types";
import { ActivitySyncError } from "@/lib/sync/errors";
import type { SyncStatus } from "@/types/database";

export type ActivityRelationValidationReason =
  | "relation_not_found"
  | "wrong_master_type"
  | "inactive_relation"
  | "too_many_relations"
  | "duplicate_relation"
  | "invalid_customer_relation"
  | "archived_customer_forbidden"
  | "missing_required_relation"
  | "invalid_contact_relation"
  | "inactive_contact_forbidden"
  | "contact_customer_mismatch"
  | "invalid_deal_relation"
  | "deal_customer_mismatch";

const FIELD_LABELS: Record<string, string> = {
  customerPageId: "顧客アカウント",
  dealPageId: "関連案件",
  contactPageIds: "顧客担当者",
  categoryPageIds: "対応分類",
};

export type MasterLookupRow = {
  notion_page_id: string;
  master_type: string;
  is_active: boolean;
};

export type CustomerLookupRow = {
  notion_page_id: string;
  is_archived: boolean;
  sync_status: SyncStatus;
};

export type ContactLookupRow = {
  notion_page_id: string;
  customer_page_id: string | null;
  is_active: boolean;
};

export type DealLookupRow = {
  notion_page_id: string;
  customer_page_id: string | null;
};

export type ActivityRelationLookupData = {
  masters: MasterLookupRow[];
  customers: CustomerLookupRow[];
  contacts: ContactLookupRow[];
  deals: DealLookupRow[];
};

export type ActivityRelationLooseInput = Omit<
  ActivityWriteInput,
  "customerPageId" | "dealPageId"
> & {
  customerPageId: string | string[] | null;
  dealPageId: string | string[] | null;
};

export type CurrentActivityRelations = {
  customerPageId: string | null;
  dealPageId: string | null;
  contactPageIds: string[];
  categoryPageIds: string[];
};

export type ActivityRelationValidationContext = {
  current?: CurrentActivityRelations;
};

function fail(
  reason: ActivityRelationValidationReason,
  field: string,
): never {
  const label = FIELD_LABELS[field] ?? field;
  const messages: Record<ActivityRelationValidationReason, string> = {
    relation_not_found: `${label}に存在しない選択肢が指定されています`,
    wrong_master_type: `${label}に別種別の選択肢が指定されています`,
    inactive_relation: `${label}に無効化された選択肢は新しく指定できません`,
    too_many_relations: `${label}は1件のみ指定できます`,
    duplicate_relation: `${label}に重複した選択肢が指定されています`,
    invalid_customer_relation: `${label}に指定できない顧客が含まれています`,
    archived_customer_forbidden: `アーカイブ済みの顧客へは新規に対応履歴を設定できません`,
    missing_required_relation: `${label}は必須です`,
    invalid_contact_relation: `顧客担当者に存在しない担当者が指定されています`,
    inactive_contact_forbidden: `無効な顧客担当者は新しく指定できません`,
    contact_customer_mismatch: `顧客担当者は選択中の顧客に所属している必要があります`,
    invalid_deal_relation: `関連案件に存在しない案件が指定されています`,
    deal_customer_mismatch: `関連案件は選択中の顧客に所属している必要があります`,
  };
  throw new ActivitySyncError("validation", messages[reason], {
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

export function collectActivityRelationIds(input: ActivityRelationLooseInput): {
  masterIds: string[];
  customerPageIds: string[];
  contactPageIds: string[];
  dealPageIds: string[];
} {
  const single = (v: string | string[] | null): string[] =>
    v === null ? [] : typeof v === "string" ? (v ? [v] : []) : v.filter(Boolean);
  return {
    masterIds: dedupe(input.categoryPageIds),
    customerPageIds: dedupe(single(input.customerPageId)),
    contactPageIds: dedupe(input.contactPageIds),
    dealPageIds: dedupe(single(input.dealPageId)),
  };
}

export async function loadActivityRelationLookup(
  db: { from(table: string): any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  ids: {
    masterIds: string[];
    customerPageIds: string[];
    contactPageIds: string[];
    dealPageIds: string[];
  },
): Promise<ActivityRelationLookupData> {
  const [masters, customers, contacts, deals] = await Promise.all([
    ids.masterIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("masters_cache")
          .select("notion_page_id,master_type,is_active")
          .in("notion_page_id", ids.masterIds),
    ids.customerPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("customer_index")
          .select("notion_page_id,is_archived,sync_status")
          .in("notion_page_id", ids.customerPageIds),
    ids.contactPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("contact_index")
          .select("notion_page_id,customer_page_id,is_active")
          .in("notion_page_id", ids.contactPageIds),
    ids.dealPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("deal_index")
          .select("notion_page_id,customer_page_id")
          .in("notion_page_id", ids.dealPageIds),
  ]);
  for (const r of [masters, customers, contacts, deals]) {
    if (r.error) {
      throw new Error(`relation lookupに失敗しました: ${r.error.message}`);
    }
  }
  return {
    masters: (masters.data ?? []) as MasterLookupRow[],
    customers: (customers.data ?? []) as CustomerLookupRow[],
    contacts: (contacts.data ?? []) as ContactLookupRow[],
    deals: (deals.data ?? []) as DealLookupRow[],
  };
}

export function validateActivityRelations(input: {
  write: ActivityRelationLooseInput;
  lookup: ActivityRelationLookupData;
  context?: ActivityRelationValidationContext;
}): ActivityWriteInput {
  const { write, lookup, context } = input;
  const current = context?.current;

  const mastersById = new Map(
    lookup.masters.map((m) => [m.notion_page_id, m]),
  );
  const customersById = new Map(
    lookup.customers.map((c) => [c.notion_page_id, c]),
  );
  const contactsById = new Map(
    lookup.contacts.map((c) => [c.notion_page_id, c]),
  );
  const dealsById = new Map(lookup.deals.map((d) => [d.notion_page_id, d]));

  const isRetainedCategory = (id: string): boolean =>
    Boolean(current?.categoryPageIds?.includes(id));
  const isRetainedCustomer = (id: string): boolean =>
    Boolean(current?.customerPageId && current.customerPageId === id);
  const isRetainedContact = (id: string): boolean =>
    Boolean(current?.contactPageIds?.includes(id));
  const isRetainedDeal = (id: string): boolean =>
    Boolean(current?.dealPageId && current.dealPageId === id);

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
  if (!isRetainedCustomer(customerPageId)) {
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
    if (
      deal.customer_page_id !== customerPageId &&
      !isRetainedDeal(dealPageId)
    ) {
      fail("deal_customer_mismatch", "dealPageId");
    }
    if (deal.customer_page_id !== customerPageId) {
      fail("deal_customer_mismatch", "dealPageId");
    }
  }

  const contactPageIds = dedupe(write.contactPageIds);
  for (const id of contactPageIds) {
    const row = contactsById.get(id);
    if (!row) fail("invalid_contact_relation", "contactPageIds");
    if (row.customer_page_id !== customerPageId) {
      fail("contact_customer_mismatch", "contactPageIds");
    }
    if (!row.is_active && !isRetainedContact(id)) {
      fail("inactive_contact_forbidden", "contactPageIds");
    }
  }

  const categoryPageIds = dedupe(write.categoryPageIds);
  for (const id of categoryPageIds) {
    const row = mastersById.get(id);
    if (!row) fail("relation_not_found", "categoryPageIds");
    if (row.master_type !== "対応履歴分類") {
      fail("wrong_master_type", "categoryPageIds");
    }
    if (!row.is_active && !isRetainedCategory(id)) {
      fail("inactive_relation", "categoryPageIds");
    }
  }

  return {
    ...write,
    customerPageId,
    dealPageId,
    contactPageIds,
    categoryPageIds,
  };
}
