import { NotionHttpError } from "@/lib/notion/client-core";
import { CustomerSyncError } from "@/lib/sync/errors";

export type NotionErrorClass =
  | "rate_limited"
  | "auth"
  | "not_found"
  | "validation"
  | "ambiguous_write"
  | "transient"
  | "unknown";

export function classifyNotionError(error: unknown): NotionErrorClass {
  if (error instanceof NotionHttpError) {
    if (error.status === 429) return "rate_limited";
    if (error.status === 401 || error.status === 403) return "auth";
    if (error.status === 404) return "not_found";
    if (error.status === 400) return "validation";
    if (error.code === "write_ambiguous_failure") return "ambiguous_write";
    if (error.status >= 500) return "transient";
  }
  if (error instanceof CustomerSyncError) {
    if (error.code === "ambiguous_write") return "ambiguous_write";
    if (error.code === "notion_failed") return "transient";
    if (error.code === "not_found") return "not_found";
  }
  return "unknown";
}
