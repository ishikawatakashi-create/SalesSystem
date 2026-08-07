import type { ContractDomain } from "@/lib/notion/converters/contract";
import type { SyncStatus, WriteOpStatus } from "@/types/database";
import type { WriteOperationRow } from "@/lib/customers/types";

export type { WriteOperationRow };

/**
 * 契約書込入力(表示用原文)。
 * 契約書ファイル(files)は書込対象外。空欄は null。
 */
export type ContractWriteInput = {
  title: string;
  customerPageId: string;
  dealPageId: string | null;
  contractTypePageId: string | null;
  tradeTypePageId: string | null;
  paymentStatusPageId: string | null;
  statusPageId: string | null;
  /** 担当者(複数) */
  staffPageIds: string[];
  /** null | 非負整数 */
  amount: number | null;
  contractedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  autoRenew: boolean;
  billingTerms: string | null;
  contractUrl: string | null;
  note: string | null;
};

export type ContractCreateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  input: ContractWriteInput;
  externalId?: string;
};

export type ContractUpdateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  notionPageId: string;
  externalId: string;
  expectedLastEditedTime: string;
  input: ContractWriteInput;
};

export type ContractWriteResult = {
  status: WriteOpStatus;
  requestId: string;
  externalId: string;
  notionPageId: string | null;
  partialFailure?: boolean;
  warning?: string;
};

export type ContractCreateResult = ContractWriteResult;
export type ContractUpdateResult = ContractWriteResult;

export type ContractIndexRow = {
  notion_page_id: string;
  external_id: string;
  content_hash: string | null;
  notion_last_edited_at: string | null;
  sync_status: SyncStatus;
  sync_error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  customer_page_id: string | null;
  deal_page_id: string | null;
  contract_type_id: string | null;
  trade_type_id: string | null;
  amount: number | null;
  contracted_at: string | null;
  start_date: string | null;
  end_date: string | null;
  auto_renew: boolean;
  billing_terms: string | null;
  payment_status_id: string | null;
  status_id: string | null;
  status_semantic: string | null;
  staff_user_ids: string[];
  staff_page_ids: string[];
  has_contract_url: boolean;
  has_contract_file: boolean;
  note: string | null;
  search_text: string;
};

export type ContractRecoveryPayload = {
  expectedProperties: Record<string, unknown>;
  expectedRelations: {
    customerPageId: string;
    dealPageId: string | null;
    contractTypePageId: string | null;
    tradeTypePageId: string | null;
    paymentStatusPageId: string | null;
    statusPageId: string | null;
    staffPageIds: string[];
  };
  expectedContentHash: string;
  expectedLastEditedTime?: string;
  displaySnapshot: ContractWriteInput;
};

export type ContractDetail = ContractDomain & {
  createdTime: string;
  lastEditedTime: string;
  contentHash: string;
};

export type ContractListSortKey =
  | "updated_at"
  | "title"
  | "contracted_at"
  | "start_date"
  | "end_date"
  | "amount";

export type ContractListQuery = {
  q?: string;
  customerPageId?: string;
  dealPageId?: string;
  tradeTypeId?: string;
  statusId?: string;
  /** 有効契約など。CONTRACT_ACTIVE_SEMANTIC */
  statusSemantic?: string;
  paymentStatusId?: string;
  staffUserId?: string;
  endDateFrom?: string;
  endDateTo?: string;
  contractedAtFrom?: string;
  contractedAtTo?: string;
  amountMin?: number;
  amountMax?: number;
  sort?: ContractListSortKey;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

/** 顧客詳細「有効契約」用。契約状態 semantic_key */
export const CONTRACT_ACTIVE_SEMANTIC = "active" as const;

export const CONTRACT_STATUS_SEMANTICS = {
  active: "active",
  expired: "expired",
  cancelled: "cancelled",
  void: "void",
} as const;

export type ContractStatusSemantic =
  (typeof CONTRACT_STATUS_SEMANTICS)[keyof typeof CONTRACT_STATUS_SEMANTICS];

export const CONTRACT_PAYMENT_SEMANTICS = {
  unbilled: "unbilled",
  billed: "billed",
  paid: "paid",
  overdue: "overdue",
} as const;

export type ContractPaymentSemantic =
  (typeof CONTRACT_PAYMENT_SEMANTICS)[keyof typeof CONTRACT_PAYMENT_SEMANTICS];

export function isContractActiveSemantic(
  key: string | null | undefined,
): boolean {
  return key === CONTRACT_ACTIVE_SEMANTIC;
}
