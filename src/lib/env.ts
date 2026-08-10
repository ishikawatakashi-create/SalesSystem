/**
 * 環境変数アクセス。サーバー専用値の取得はサーバーモジュールからのみ行うこと。
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません(.env.local を確認してください)`);
  }
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

const EXPLICIT_APP_URL_ENV_NAMES = [
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "SITE_URL",
  "NEXT_PUBLIC_SITE_URL",
] as const;

const VERCEL_APP_URL_ENV_NAMES = [
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "NEXT_PUBLIC_VERCEL_URL",
] as const;

function normalizeAppUrl(name: string, value: string): string {
  const trimmed = value.trim();
  const localWithoutProtocol = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::|\/|$)/i.test(
    trimmed,
  );
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `${localWithoutProtocol ? "http" : "https"}://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`環境変数 ${name} に有効なアプリURLを設定してください`);
  }
  if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) {
    throw new Error(`環境変数 ${name} はhttp(s) URLである必要があります`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`環境変数 ${name} はoriginまたはベースURLだけを設定してください`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

function isLocalUrl(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function isDeployedRuntime(): boolean {
  return Boolean(process.env.VERCEL_ENV) || process.env.NODE_ENV === "production";
}

/**
 * サーバー生成リンクで使うcanonical app URL。
 * 明示設定を優先し、Vercelではproject production URLへフォールバックする。
 * localhost fallbackはローカル開発専用で、デプロイ環境ではfail-closedにする。
 */
export function appUrl(): string {
  for (const name of EXPLICIT_APP_URL_ENV_NAMES) {
    const value = process.env[name];
    if (!value?.trim()) continue;
    const normalized = normalizeAppUrl(name, value);
    if (isDeployedRuntime() && isLocalUrl(normalized)) {
      throw new Error(
        `デプロイ環境の ${name} にlocalhostを設定することはできません`,
      );
    }
    if (isDeployedRuntime() && new URL(normalized).protocol !== "https:") {
      throw new Error(`デプロイ環境の ${name} はhttps URLである必要があります`);
    }
    return normalized;
  }

  for (const name of VERCEL_APP_URL_ENV_NAMES) {
    const value = process.env[name];
    if (!value?.trim()) continue;
    return normalizeAppUrl(name, value);
  }

  if (isDeployedRuntime()) {
    throw new Error(
      "デプロイ環境のcanonical app URLが未設定です(APP_URLまたはNEXT_PUBLIC_APP_URLを設定してください)",
    );
  }
  return "http://localhost:3000";
}

/** Supabase標準招待メール(implicit flow)が最初に戻るブラウザ側route。 */
export function inviteRedirectUrl(): string {
  return new URL("/auth/invite", `${appUrl()}/`).toString();
}
