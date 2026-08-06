import type { ContactWriteInput } from "@/lib/contacts/types";
import { ContactSyncError } from "@/lib/sync/errors";
import type { SyncStatus } from "@/types/database";

/**
 * 先方担当者relation検証。
 * 実行位置: Zod検証後・write_operations作成前・Notion API呼出前。
 * ルックアップは一括取得(N+1禁止)。エラーメッセージにIDや入力本文を含めない。
 */

export type ContactRelationValidationReason =
  | "relation_not_found"
  | "wrong_master_type"
  | "inactive_relation"
  | "too_many_relations"
  | "invalid_customer_relation"
  | "archived_customer_forbidden"
  | "missing_required_relation";

const CONTACT_TYPE_MASTER = "担当者区分";

const FIELD_LABELS: Record<string, string> = {
  customerPageId: "所属アカウント",
  contactTypePageId: "区分",
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

export type ContactRelationLookupData = {
  masters: MasterLookupRow[];
  customers: CustomerLookupRow[];
};

/**
 * 単一relation欄はクライアント入力の揺れを許容するため配列も受け付け、
 * 検証内で 0/1件へ正規化する(2件以上は too_many_relations)。
 */
export type ContactRelationLooseInput = Omit<
  ContactWriteInput,
  "customerPageId" | "contactTypePageId"
> & {
  customerPageId: string | string[] | null;
  contactTypePageId: string | string[] | null;
};

/** 更新時の変更前relation。維持されている無効値を許可する判定に使う */
export type CurrentContactRelations = {
  customerPageId: string | null;
  contactTypePageId: string | null;
};

export type ContactRelationValidationContext = {
  current?: CurrentContactRelations;
};

function fail(
  reason: ContactRelationValidationReason,
  field: string,
): never {
  const label = FIELD_LABELS[field] ?? field;
  const messages: Record<ContactRelationValidationReason, string> = {
    relation_not_found: `${label}に存在しない選択肢が指定されています`,
    wrong_master_type: `${label}に別種別の選択肢が指定されています`,
    inactive_relation: `${label}に無効化された選択肢は新しく指定できません`,
    too_many_relations: `${label}は1件のみ指定できます`,
    invalid_customer_relation: `${label}に指定できない顧客が含まれています`,
    archived_customer_forbidden: `アーカイブ済みの顧客へは新規に所属を設定できません`,
    missing_required_relation: `${label}は必須です`,
  };
  throw new ContactSyncError("validation", messages[reason], {
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
export function collectContactRelationIds(input: ContactRelationLooseInput): {
  masterIds: string[];
  customerPageIds: string[];
} {
  const single = (v: string | string[] | null): string[] =>
    v === null ? [] : typeof v === "string" ? (v ? [v] : []) : v.filter(Boolean);
  return {
    masterIds: dedupe(single(input.contactTypePageId)),
    customerPageIds: dedupe(single(input.customerPageId)),
  };
}

/** 一括ルックアップ(2クエリ固定。IDごとの個別SQLは発行しない) */
export async function loadContactRelationLookup(
  db: { from(table: string): any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  ids: { masterIds: string[]; customerPageIds: string[] },
): Promise<ContactRelationLookupData> {
  const [masters, customers] = await Promise.all([
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
  ]);
  for (const r of [masters, customers]) {
    if (r.error) {
      throw new Error(`relation lookupに失敗しました: ${r.error.message}`);
    }
  }
  return {
    masters: (masters.data ?? []) as MasterLookupRow[],
    customers: (customers.data ?? []) as CustomerLookupRow[],
  };
}

/**
 * relation検証本体。
 * - 所属アカウント: 必須・customer_index存在・(新規指定は)非アーカイブ
 * - 区分: masters_cache(担当者区分)・(新規指定は)is_active
 * - 更新前から維持している無効値・アーカイブ済み所属は許可
 */
export function validateContactRelations(input: {
  write: ContactRelationLooseInput;
  lookup: ContactRelationLookupData;
  context?: ContactRelationValidationContext;
}): ContactWriteInput {
  const { write, lookup, context } = input;
  const current = context?.current;

  const mastersById = new Map(
    lookup.masters.map((m) => [m.notion_page_id, m]),
  );
  const customersById = new Map(
    lookup.customers.map((c) => [c.notion_page_id, c]),
  );

  const isRetainedCustomer = (id: string): boolean =>
    Boolean(current?.customerPageId && current.customerPageId === id);

  const isRetainedType = (id: string): boolean =>
    Boolean(current?.contactTypePageId && current.contactTypePageId === id);

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

  const contactTypePageId = normalizeSingle(
    write.contactTypePageId,
    "contactTypePageId",
  );
  if (contactTypePageId) {
    const row = mastersById.get(contactTypePageId);
    if (!row) fail("relation_not_found", "contactTypePageId");
    if (row.master_type !== CONTACT_TYPE_MASTER) {
      fail("wrong_master_type", "contactTypePageId");
    }
    if (!row.is_active && !isRetainedType(contactTypePageId)) {
      fail("inactive_relation", "contactTypePageId");
    }
  }

  return {
    ...write,
    customerPageId,
    contactTypePageId,
  };
}
