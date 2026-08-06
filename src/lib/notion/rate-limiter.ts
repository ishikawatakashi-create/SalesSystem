import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  SupabaseNotionRateLimiter,
  type NotionRateLimiter,
} from "@/lib/notion/rate-limiter-core";

export type {
  NotionRateLimiter,
  NotionRequestPriority,
  ReservedSlot,
} from "@/lib/notion/rate-limiter-core";
export {
  SupabaseNotionRateLimiter,
  withNotionRateLimit,
} from "@/lib/notion/rate-limiter-core";

/**
 * アプリ既定のレートリミッター。
 * 将来 notion_request_queue 方式へ差し替える場合もこのファクトリを差し替える。
 * interactive優先を保証するとは表現しない(到着順+間隔係数)。
 */
export function createNotionRateLimiter(): NotionRateLimiter {
  return new SupabaseNotionRateLimiter({
    createClient: () => createAdminClient() as never,
  });
}
