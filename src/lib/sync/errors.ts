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
