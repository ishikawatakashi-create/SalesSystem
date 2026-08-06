import "server-only";

import type { Client } from "@notionhq/client";

import {
  createNotionClient,
  type NotionClientOptions,
} from "@/lib/notion/client-core";
import { createNotionRateLimiter } from "@/lib/notion/rate-limiter";

export {
  createNotionClient,
  NotionHttpError,
  parseRetryAfterSeconds,
  backoffMs,
} from "@/lib/notion/client-core";
export type { NotionClientOptions, NotionHttpFetch } from "@/lib/notion/client-core";
export { NOTION_API_VERSION } from "@/lib/notion/version";

/** Next.jsサーバー用の既定クライアント */
export function createDefaultNotionClient(
  options?: Partial<NotionClientOptions>,
): Client {
  const token = options?.token ?? process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error("環境変数 NOTION_TOKEN が設定されていません");
  }
  return createNotionClient({
    token,
    rateLimiter: options?.rateLimiter ?? createNotionRateLimiter(),
    ...options,
  });
}
