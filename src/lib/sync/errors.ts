export class CustomerSyncError extends Error {
  constructor(
    readonly code:
      | "input_hash_mismatch"
      | "conflict"
      | "notion_failed"
      | "ambiguous_write"
      | "not_found"
      | "in_trash"
      | "validation"
      | "forbidden_state",
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CustomerSyncError";
  }
}

export function isCustomerSyncError(error: unknown): error is CustomerSyncError {
  return error instanceof CustomerSyncError;
}

/** 先方担当者(顧客担当者)書込の同期エラー。コード体系は顧客と共通 */
export class ContactSyncError extends Error {
  constructor(
    readonly code:
      | "input_hash_mismatch"
      | "conflict"
      | "notion_failed"
      | "ambiguous_write"
      | "not_found"
      | "in_trash"
      | "validation"
      | "forbidden_state",
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ContactSyncError";
  }
}

export function isContactSyncError(error: unknown): error is ContactSyncError {
  return error instanceof ContactSyncError;
}

/** 案件書込の同期エラー。コード体系は顧客・先方担当者と共通 */
export class DealSyncError extends Error {
  constructor(
    readonly code:
      | "input_hash_mismatch"
      | "conflict"
      | "notion_failed"
      | "ambiguous_write"
      | "not_found"
      | "in_trash"
      | "validation"
      | "forbidden_state",
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DealSyncError";
  }
}

export function isDealSyncError(error: unknown): error is DealSyncError {
  return error instanceof DealSyncError;
}

/** 対応履歴書込の同期エラー。コード体系は案件と共通 */
export class ActivitySyncError extends Error {
  constructor(
    readonly code:
      | "input_hash_mismatch"
      | "conflict"
      | "notion_failed"
      | "ambiguous_write"
      | "not_found"
      | "in_trash"
      | "validation"
      | "forbidden_state",
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ActivitySyncError";
  }
}

export function isActivitySyncError(
  error: unknown,
): error is ActivitySyncError {
  return error instanceof ActivitySyncError;
}

/** 次回アクション書込の同期エラー。コード体系は案件と共通 */
export class ActionSyncError extends Error {
  constructor(
    readonly code:
      | "input_hash_mismatch"
      | "conflict"
      | "notion_failed"
      | "ambiguous_write"
      | "not_found"
      | "in_trash"
      | "validation"
      | "forbidden_state",
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ActionSyncError";
  }
}

export function isActionSyncError(error: unknown): error is ActionSyncError {
  return error instanceof ActionSyncError;
}

/** 契約書込の同期エラー。コード体系は案件と共通 */
export class ContractSyncError extends Error {
  constructor(
    readonly code:
      | "input_hash_mismatch"
      | "conflict"
      | "notion_failed"
      | "ambiguous_write"
      | "not_found"
      | "in_trash"
      | "validation"
      | "forbidden_state",
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ContractSyncError";
  }
}

export function isContractSyncError(
  error: unknown,
): error is ContractSyncError {
  return error instanceof ContractSyncError;
}

/** クレーム書込の同期エラー。コード体系は案件と共通 */
export class ComplaintSyncError extends Error {
  constructor(
    readonly code:
      | "input_hash_mismatch"
      | "conflict"
      | "notion_failed"
      | "ambiguous_write"
      | "not_found"
      | "in_trash"
      | "validation"
      | "forbidden_state",
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ComplaintSyncError";
  }
}

export function isComplaintSyncError(
  error: unknown,
): error is ComplaintSyncError {
  return error instanceof ComplaintSyncError;
}
