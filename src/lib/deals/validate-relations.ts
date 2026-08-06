import type { DealWriteInput } from "@/lib/deals/types";
import { DealSyncError } from "@/lib/sync/errors";
import type { SyncStatus } from "@/types/database";

/**
 * 案件relation検証。
 * 実行位置: Zod検証後・write_operations作成前・Notion API呼出前。
 * ルックアップは一括取得(N+1禁止)。エラーメッセージにIDや入力本文を含めない。
 */

export type DealRelationValidationReason =
  | "relation_not_found"
  | "wrong_master_type"
  | "inactive_relation"
  | "too_many_relations"
  | "duplicate_relation"
  | "invalid_staff"
  | "invalid_customer_relation"
  | "archived_customer_forbidden"
  | "missing_required_relation"
  | "invalid_contact_relation"
  | "inactive_contact_forbidden"
  | "contact_customer_mismatch";

export const DEAL_MASTER_FIELDS = {
  businessCategoryPageId: "事業区分",
  stagePageId: "案件ステージ",
  statusPageId: "案件ステータス",
} as const;

type MasterField = keyof typeof DEAL_MASTER_FIELDS;

const FIELD_LABELS: Record<string, string> = {
  customerPageId: "顧客アカウント",
  contactPageIds: "顧客担当者",
  businessCategoryPageId: "事業区分",
  stagePageId: "営業ステージ",
  staffPageIds: "自社担当者",
  statusPageId: "ステータス",
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

export type ContactLookupRow = {
  notion_page_id: string;
  customer_page_id: string | null;
  is_active: boolean;
};

export type DealRelationLookupData = {
  masters: MasterLookupRow[];
  staff: StaffLookupRow[];
  customers: CustomerLookupRow[];
  contacts: ContactLookupRow[];
};

/**
 * 単一relation欄はクライアント入力の揺れを許容するため配列も受け付け、
 * 検証内で 0/1件へ正規化する(2件以上は too_many_relations)。
 */
export type DealRelationLooseInput = Omit<
  DealWriteInput,
  | "customerPageId"
  | "businessCategoryPageId"
  | "stagePageId"
  | "statusPageId"
> & {
  customerPageId: string | string[] | null;
  businessCategoryPageId: string | string[] | null;
  stagePageId: string | string[] | null;
  statusPageId: string | string[] | null;
};

/** 更新時の変更前relation。維持されている無効値を許可する判定に使う */
export type CurrentDealRelations = {
  customerPageId: string | null;
  contactPageIds: string[];
  businessCategoryPageId: string | null;
  stagePageId: string | null;
  staffPageIds: string[];
  statusPageId: string | null;
};

export type DealRelationValidationContext = {
  current?: CurrentDealRelations;
};

function fail(
  reason: DealRelationValidationReason,
  field: string,
): never {
  const label = FIELD_LABELS[field] ?? field;
  const messages: Record<DealRelationValidationReason, string> = {
    relation_not_found: `${label}に存在しない選択肢が指定されています`,
    wrong_master_type: `${label}に別種別の選択肢が指定されています`,
    inactive_relation: `${label}に無効化された選択肢は新しく指定できません`,
    too_many_relations: `${label}は1件のみ指定できます`,
    duplicate_relation: `${label}に重複した選択肢が指定されています`,
    invalid_staff: `自社担当者に不明な担当者が指定されています`,
    invalid_customer_relation: `${label}に指定できない顧客が含まれています`,
    archived_customer_forbidden: `アーカイブ済みの顧客へは新規に案件を設定できません`,
    missing_required_relation: `${label}は必須です`,
    invalid_contact_relation: `顧客担当者に存在しない担当者が指定されています`,
    inactive_contact_forbidden: `無効な顧客担当者は新しく指定できません`,
    contact_customer_mismatch: `顧客担当者は選択中の顧客に所属している必要があります`,
  };
  throw new DealSyncError("validation", messages[reason], {
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

/** 入力中の全relation IDを収集する(一括ルックアップ用) */
export function collectDealRelationIds(input: DealRelationLooseInput): {
  masterIds: string[];
  staffPageIds: string[];
  customerPageIds: string[];
  contactPageIds: string[];
} {
  const single = (v: string | string[] | null): string[] =>
    v === null ? [] : typeof v === "string" ? (v ? [v] : []) : v.filter(Boolean);
  return {
    masterIds: dedupe([
      ...single(input.businessCategoryPageId),
      ...single(input.stagePageId),
      ...single(input.statusPageId),
    ]),
    staffPageIds: dedupe(input.staffPageIds),
    customerPageIds: dedupe(single(input.customerPageId)),
    contactPageIds: dedupe(input.contactPageIds),
  };
}

/** 一括ルックアップ(4クエリ固定。IDごとの個別SQLは発行しない) */
export async function loadDealRelationLookup(
  db: { from(table: string): any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  ids: {
    masterIds: string[];
    staffPageIds: string[];
    customerPageIds: string[];
    contactPageIds: string[];
  },
): Promise<DealRelationLookupData> {
  const [masters, staff, customers, contacts] = await Promise.all([
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
    ids.contactPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("contact_index")
          .select("notion_page_id,customer_page_id,is_active")
          .in("notion_page_id", ids.contactPageIds),
  ]);
  for (const r of [masters, staff, customers, contacts]) {
    if (r.error) {
      throw new Error(`relation lookupに失敗しました: ${r.error.message}`);
    }
  }
  return {
    masters: (masters.data ?? []) as MasterLookupRow[],
    staff: (staff.data ?? []) as StaffLookupRow[],
    customers: (customers.data ?? []) as CustomerLookupRow[],
    contacts: (contacts.data ?? []) as ContactLookupRow[],
  };
}

/**
 * relation検証本体。
 */
export function validateDealRelations(input: {
  write: DealRelationLooseInput;
  lookup: DealRelationLookupData;
  context?: DealRelationValidationContext;
}): DealWriteInput {
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
  const contactsById = new Map(
    lookup.contacts.map((c) => [c.notion_page_id, c]),
  );

  const isRetainedMaster = (field: MasterField, id: string): boolean =>
    Boolean(current?.[field] && current[field] === id);

  const isRetainedCustomer = (id: string): boolean =>
    Boolean(current?.customerPageId && current.customerPageId === id);

  const isRetainedContact = (id: string): boolean =>
    Boolean(current?.contactPageIds?.includes(id));

  const isRetainedStaff = (id: string): boolean =>
    Boolean(current?.staffPageIds?.includes(id));

  const checkMaster = (field: MasterField, id: string) => {
    const row = mastersById.get(id);
    if (!row) fail("relation_not_found", field);
    if (row.master_type !== DEAL_MASTER_FIELDS[field]) {
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

  const customerChanged =
    Boolean(current?.customerPageId) &&
    current!.customerPageId !== customerPageId;

  const contactPageIds = dedupe(write.contactPageIds);
  if (contactPageIds.length !== write.contactPageIds.length) {
    // 重複は取り除いて続行(顧客と同様)
  }
  for (const id of contactPageIds) {
    const row = contactsById.get(id);
    if (!row) fail("invalid_contact_relation", "contactPageIds");
    if (row.customer_page_id !== customerPageId) {
      fail("contact_customer_mismatch", "contactPageIds");
    }
    if (!row.is_active && !isRetainedContact(id)) {
      fail("inactive_contact_forbidden", "contactPageIds");
    }
    // 顧客変更時は新顧客に所属しない担当を拒否(上の mismatch でカバー)
    if (customerChanged && row.customer_page_id !== customerPageId) {
      fail("contact_customer_mismatch", "contactPageIds");
    }
  }

  const businessCategoryPageId = normalizeSingle(
    write.businessCategoryPageId,
    "businessCategoryPageId",
  );
  if (businessCategoryPageId) {
    checkMaster("businessCategoryPageId", businessCategoryPageId);
  }

  const stagePageId = normalizeSingle(write.stagePageId, "stagePageId");
  if (stagePageId) checkMaster("stagePageId", stagePageId);

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
    contactPageIds,
    businessCategoryPageId,
    stagePageId,
    statusPageId,
    staffPageIds,
  };
}
