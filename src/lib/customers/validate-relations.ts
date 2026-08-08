import type { CustomerWriteInput } from "@/lib/customers/types";
import { CustomerSyncError } from "@/lib/sync/errors";
import type { SyncStatus } from "@/types/database";

/**
 * 顧客relation検証。
 * 実行位置: Zod検証後・write_operations作成前・Notion API呼出前。
 * ルックアップは一括取得(N+1禁止)。エラーメッセージにIDや入力本文を含めない。
 */

export type RelationValidationReason =
  | "relation_not_found"
  | "wrong_master_type"
  | "inactive_relation"
  | "too_many_relations"
  | "duplicate_relation"
  | "invalid_staff"
  | "self_reference"
  | "invalid_customer_relation";

/** マスタ欄 → 期待master_type */
export const CUSTOMER_MASTER_FIELDS = {
  businessCategoryPageIds: "事業区分",
  tagPageIds: "タグ",
  relationshipPageIds: "関係性",
  salesStatusPageId: "営業ステータス",
  acquisitionRoutePageId: "集客ルート",
  priorityPageId: "優先度",
} as const;

type MasterField = keyof typeof CUSTOMER_MASTER_FIELDS;

const FIELD_LABELS: Record<string, string> = {
  businessCategoryPageIds: "事業区分",
  tagPageIds: "タグ",
  relationshipPageIds: "関係性",
  salesStatusPageId: "営業ステータス",
  acquisitionRoutePageId: "集客ルート",
  priorityPageId: "優先度",
  staffPageIds: "自社担当者",
  relatedAccountPageIds: "関連アカウント",
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

export type RelatedCustomerLookupRow = {
  notion_page_id: string;
  is_archived: boolean;
  sync_status: SyncStatus;
};

export type RelationLookupData = {
  masters: MasterLookupRow[];
  staff: StaffLookupRow[];
  relatedCustomers: RelatedCustomerLookupRow[];
};

/**
 * 単一relation欄はクライアント入力の揺れを許容するため配列も受け付け、
 * 検証内で 0/1件へ正規化する(2件以上は too_many_relations)。
 */
export type CustomerRelationLooseInput = Omit<
  CustomerWriteInput,
  "salesStatusPageId" | "acquisitionRoutePageId" | "priorityPageId"
> & {
  salesStatusPageId: string | string[] | null;
  acquisitionRoutePageId: string | string[] | null;
  priorityPageId: string | string[] | null;
};

/** 更新時の変更前relation。維持されている無効値を許可する判定に使う */
export type CurrentRelations = {
  businessCategoryPageIds: string[];
  tagPageIds: string[];
  relationshipPageIds: string[];
  salesStatusPageId: string | null;
  acquisitionRoutePageId: string | null;
  priorityPageId: string | null;
  staffPageIds: string[];
  relatedAccountPageIds: string[];
};

export type RelationValidationContext = {
  current?: CurrentRelations;
  /** 更新対象自身のnotion_page_id(関連アカウントの自己参照拒否) */
  selfPageId?: string;
};

function fail(reason: RelationValidationReason, field: string): never {
  const label = FIELD_LABELS[field] ?? field;
  const messages: Record<RelationValidationReason, string> = {
    relation_not_found: `${label}に存在しない選択肢が指定されています`,
    wrong_master_type: `${label}に別種別の選択肢が指定されています`,
    inactive_relation: `${label}に無効化された選択肢は新しく指定できません`,
    too_many_relations: `${label}は1件のみ指定できます`,
    duplicate_relation: `${label}に重複した選択肢が指定されています`,
    invalid_staff: `自社担当者に不明な担当者が指定されています`,
    self_reference: `関連アカウントに自分自身は指定できません`,
    invalid_customer_relation: `関連アカウントに指定できない顧客が含まれています`,
  };
  throw new CustomerSyncError("validation", messages[reason], {
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
export function collectCustomerRelationIds(input: CustomerRelationLooseInput): {
  masterIds: string[];
  staffPageIds: string[];
  relatedPageIds: string[];
} {
  const single = (v: string | string[] | null): string[] =>
    v === null ? [] : typeof v === "string" ? [v] : v;
  return {
    masterIds: dedupe([
      ...input.businessCategoryPageIds,
      ...input.tagPageIds,
      ...(input.relationshipPageIds ?? []),
      ...single(input.salesStatusPageId),
      ...single(input.acquisitionRoutePageId),
      ...single(input.priorityPageId),
    ]),
    staffPageIds: dedupe(input.staffPageIds),
    relatedPageIds: dedupe(input.relatedAccountPageIds),
  };
}

/** 一括ルックアップ(3クエリ固定。IDごとの個別SQLは発行しない) */
export async function loadCustomerRelationLookup(
  db: { from(table: string): any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  ids: { masterIds: string[]; staffPageIds: string[]; relatedPageIds: string[] },
): Promise<RelationLookupData> {
  const [masters, staff, related] = await Promise.all([
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
    ids.relatedPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("customer_index")
          .select("notion_page_id,is_archived,sync_status")
          .in("notion_page_id", ids.relatedPageIds),
  ]);
  for (const r of [masters, staff, related]) {
    if (r.error) {
      throw new Error(`relation lookupに失敗しました: ${r.error.message}`);
    }
  }
  return {
    masters: (masters.data ?? []) as MasterLookupRow[],
    staff: (staff.data ?? []) as StaffLookupRow[],
    relatedCustomers: (related.data ?? []) as RelatedCustomerLookupRow[],
  };
}

/**
 * relation検証本体。
 * - マスタ欄: 存在・master_type一致・(新規指定は)is_active
 * - 自社担当者: app_users対応・(新規指定は)is_active
 * - 関連アカウント: customer_index存在・自己参照拒否・(新規指定は)非アーカイブかつ
 *   delete_pending/excluded以外
 * - 更新前から維持している無効値・アーカイブ済み関連は許可
 * - 重複IDは正規化(dedupe)して返す
 */
export function validateCustomerRelations(input: {
  write: CustomerRelationLooseInput;
  lookup: RelationLookupData;
  context?: RelationValidationContext;
}): CustomerWriteInput {
  const { write, lookup, context } = input;
  const current = context?.current;

  const mastersById = new Map(
    lookup.masters.map((m) => [m.notion_page_id, m]),
  );
  const staffByPageId = new Map(
    lookup.staff.map((s) => [s.notion_staff_page_id, s]),
  );
  const relatedById = new Map(
    lookup.relatedCustomers.map((c) => [c.notion_page_id, c]),
  );

  const isRetained = (field: MasterField | "staffPageIds" | "relatedAccountPageIds", id: string): boolean => {
    if (!current) return false;
    const cur = current[field];
    if (cur === null || cur === undefined) return false;
    return Array.isArray(cur) ? cur.includes(id) : cur === id;
  };

  const checkMaster = (field: MasterField, id: string) => {
    const row = mastersById.get(id);
    if (!row) fail("relation_not_found", field);
    if (row.master_type !== CUSTOMER_MASTER_FIELDS[field]) {
      fail("wrong_master_type", field);
    }
    if (!row.is_active && !isRetained(field, id)) {
      fail("inactive_relation", field);
    }
  };

  const businessCategoryPageIds = dedupe(write.businessCategoryPageIds);
  for (const id of businessCategoryPageIds) {
    checkMaster("businessCategoryPageIds", id);
  }
  const tagPageIds = dedupe(write.tagPageIds);
  for (const id of tagPageIds) {
    checkMaster("tagPageIds", id);
  }
  const relationshipPageIds = dedupe(write.relationshipPageIds ?? []);
  for (const id of relationshipPageIds) {
    checkMaster("relationshipPageIds", id);
  }

  const salesStatusPageId = normalizeSingle(
    write.salesStatusPageId,
    "salesStatusPageId",
  );
  if (salesStatusPageId) checkMaster("salesStatusPageId", salesStatusPageId);

  const acquisitionRoutePageId = normalizeSingle(
    write.acquisitionRoutePageId,
    "acquisitionRoutePageId",
  );
  if (acquisitionRoutePageId) {
    checkMaster("acquisitionRoutePageId", acquisitionRoutePageId);
  }

  const priorityPageId = normalizeSingle(write.priorityPageId, "priorityPageId");
  if (priorityPageId) checkMaster("priorityPageId", priorityPageId);

  const staffPageIds = dedupe(write.staffPageIds);
  for (const id of staffPageIds) {
    const row = staffByPageId.get(id);
    if (!row) fail("invalid_staff", "staffPageIds");
    if (!row.is_active && !isRetained("staffPageIds", id)) {
      fail("inactive_relation", "staffPageIds");
    }
  }

  const relatedAccountPageIds = dedupe(write.relatedAccountPageIds);
  for (const id of relatedAccountPageIds) {
    if (context?.selfPageId && id === context.selfPageId) {
      fail("self_reference", "relatedAccountPageIds");
    }
    const row = relatedById.get(id);
    if (!row) fail("invalid_customer_relation", "relatedAccountPageIds");
    const retained = isRetained("relatedAccountPageIds", id);
    if (!retained) {
      if (row.is_archived) fail("invalid_customer_relation", "relatedAccountPageIds");
      if (row.sync_status === "delete_pending" || row.sync_status === "excluded") {
        fail("invalid_customer_relation", "relatedAccountPageIds");
      }
    }
  }

  return {
    ...write,
    businessCategoryPageIds,
    tagPageIds,
    relationshipPageIds,
    salesStatusPageId,
    acquisitionRoutePageId,
    priorityPageId,
    staffPageIds,
    relatedAccountPageIds,
  };
}
