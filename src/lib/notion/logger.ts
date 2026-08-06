/**
 * Notion向け構造化ログ。トークン・Authorization・個人情報を出さない。
 */

const REDACT_KEYS = [
  "authorization",
  "token",
  "password",
  "secret",
  "email",
  "mail",
  "phone",
];

export type NotionLogFields = {
  request_id: string;
  method?: string;
  path?: string;
  status?: number;
  attempt?: number;
  error_code?: string;
  message?: string;
  [key: string]: unknown;
};

export function logNotionInfo(fields: NotionLogFields): void {
  console.info(JSON.stringify({ level: "info", scope: "notion", ...sanitize(fields) }));
}

export function logNotionWarn(fields: NotionLogFields): void {
  console.warn(JSON.stringify({ level: "warn", scope: "notion", ...sanitize(fields) }));
}

export function logNotionError(fields: NotionLogFields): void {
  console.error(JSON.stringify({ level: "error", scope: "notion", ...sanitize(fields) }));
}

function sanitize(fields: NotionLogFields): NotionLogFields {
  const out: NotionLogFields = { request_id: fields.request_id };
  for (const [key, value] of Object.entries(fields)) {
    if (key === "request_id") continue;
    const lower = key.toLowerCase();
    if (REDACT_KEYS.some((k) => lower.includes(k))) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string" && looksLikeSecret(value)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = value;
  }
  return out;
}

function looksLikeSecret(value: string): boolean {
  if (value.startsWith("secret_") || value.startsWith("ntn_")) return true;
  if (value.startsWith("Bearer ")) return true;
  if (/^[A-Za-z0-9_-]{40,}$/.test(value)) return true;
  return false;
}
