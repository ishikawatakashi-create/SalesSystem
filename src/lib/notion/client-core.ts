import { Client } from "@notionhq/client";

import { newRequestId } from "@/lib/notion/ids";
import {
  logNotionError,
  logNotionInfo,
  logNotionWarn,
} from "@/lib/notion/logger";
import {
  withNotionRateLimit,
  type NotionRateLimiter,
  type NotionRequestPriority,
} from "@/lib/notion/rate-limiter-core";
import { NOTION_API_VERSION } from "@/lib/notion/version";

export type NotionHttpFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type NotionClientOptions = {
  token: string;
  rateLimiter: NotionRateLimiter;
  fetchImpl?: NotionHttpFetch;
  defaultPriority?: NotionRequestPriority;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
};

export class NotionHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string,
    readonly bodySummary?: string,
  ) {
    super(
      `Notion HTTP ${status} (${code}) request_id=${requestId}${
        bodySummary ? ` body=${bodySummary}` : ""
      }`,
    );
    this.name = "NotionHttpError";
  }
}

const RETRYABLE_5XX = new Set([500, 502, 503, 504]);
const NON_RETRYABLE_4XX = new Set([400, 401, 403, 404]);

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Notion APIクライアント(純実装。CLI/テストからも利用可)。
 */
export function createNotionClient(options: NotionClientOptions): Client {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 5;
  const defaultPriority = options.defaultPriority ?? "bulk";

  const guardedFetch: NotionHttpFetch = async (input, init) => {
    const requestId = newRequestId();
    const method = (init?.method ?? "GET").toUpperCase();
    const url = String(input);
    const path = safePath(url);
    const isWrite = !["GET", "HEAD"].includes(method);
    const priority =
      (init as { notionPriority?: NotionRequestPriority } | undefined)
        ?.notionPriority ?? defaultPriority;

    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const response = await withNotionRateLimit(
          options.rateLimiter,
          priority,
          () => fetchImpl(input, withNotionHeaders(init, options.token)),
        );

        if (response.ok) {
          logNotionInfo({
            request_id: requestId,
            method,
            path,
            status: response.status,
            attempt,
          });
          return response;
        }

        if (response.status === 429) {
          const retryAfter = parseRetryAfterSeconds(
            response.headers.get("retry-after"),
          );
          await options.rateLimiter.reportRateLimited(retryAfter);
          logNotionWarn({
            request_id: requestId,
            method,
            path,
            status: 429,
            attempt,
            message: "rate_limited",
          });
          if (attempt > maxRetries) {
            throw new NotionHttpError(429, "rate_limited", requestId);
          }
          await sleep(retryAfter * 1000 + jitterMs(attempt));
          continue;
        }

        if (RETRYABLE_5XX.has(response.status)) {
          logNotionWarn({
            request_id: requestId,
            method,
            path,
            status: response.status,
            attempt,
            message: "transient_5xx",
          });
          if (isWrite) {
            throw new NotionHttpError(
              response.status,
              "write_ambiguous_failure",
              requestId,
            );
          }
          if (attempt > maxRetries) {
            throw new NotionHttpError(response.status, "max_retries", requestId);
          }
          await sleep(backoffMs(attempt) + jitterMs(attempt));
          continue;
        }

        if (NON_RETRYABLE_4XX.has(response.status)) {
          const bodySummary = await safeBodySummary(response);
          logNotionError({
            request_id: requestId,
            method,
            path,
            status: response.status,
            attempt,
            message: "non_retryable_4xx",
            body: bodySummary,
          });
          throw new NotionHttpError(
            response.status,
            "non_retryable",
            requestId,
            bodySummary,
          );
        }

        logNotionError({
          request_id: requestId,
          method,
          path,
          status: response.status,
          attempt,
          message: "unexpected_status",
        });
        throw new NotionHttpError(response.status, "unexpected", requestId);
      } catch (error) {
        if (error instanceof NotionHttpError) throw error;
        logNotionError({
          request_id: requestId,
          method,
          path,
          attempt,
          message: "network_or_unknown",
        });
        if (isWrite) {
          throw new NotionHttpError(0, "write_ambiguous_failure", requestId);
        }
        if (attempt > maxRetries) throw error;
        await sleep(backoffMs(attempt) + jitterMs(attempt));
      }
    }
  };

  return new Client({
    auth: options.token,
    notionVersion: NOTION_API_VERSION,
    fetch: guardedFetch,
  });
}

function withNotionHeaders(
  init: RequestInit | undefined,
  token: string,
): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Notion-Version", NOTION_API_VERSION);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  return { ...init, headers };
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.replace(/https?:\/\/[^/]+/i, "");
  }
}

async function safeBodySummary(response: Response): Promise<string> {
  try {
    const text = await response.clone().text();
    const trimmed = text.replace(/\s+/g, " ").trim().slice(0, 300);
    // トークン等を含む可能性のある長文は短縮のみ。Authorizationはheaders側。
    return trimmed || "(empty)";
  } catch {
    return "(unreadable)";
  }
}

export function parseRetryAfterSeconds(header: string | null): number {
  if (!header) return 1;
  const asInt = Number.parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return Math.max(1, asInt);
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }
  return 1;
}

export function backoffMs(attempt: number): number {
  const base = 200;
  const capped = Math.min(attempt, 6);
  return base * 2 ** (capped - 1);
}

export function jitterMs(attempt: number): number {
  return Math.floor(Math.random() * 50 * attempt);
}
