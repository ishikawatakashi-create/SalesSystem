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
