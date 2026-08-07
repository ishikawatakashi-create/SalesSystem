import "server-only";

import { getGmailAccessToken } from "@/lib/integrations/gmail/tokens";

const GMAIL_API = "https://gmail.googleapis.com";

export async function gmailFetchJson<T>(
  path: string,
  accessToken?: string,
  init?: RequestInit,
): Promise<T> {
  const token = accessToken ?? (await getGmailAccessToken());
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("gmail_auth_failed");
  }
  if (res.status === 429 || res.status >= 500) {
    throw new Error(`gmail_temporary_${res.status}`);
  }
  if (!res.ok) {
    // 本文はログしない（個人情報・トークン混入防止）
    throw new Error(`gmail_api_${res.status}`);
  }
  return (await res.json()) as T;
}

export async function gmailPostJson<T>(
  path: string,
  body: unknown,
  accessToken?: string,
): Promise<T> {
  return gmailFetchJson<T>(path, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type GmailLabel = { id: string; name: string };

export async function listGmailLabels(): Promise<GmailLabel[]> {
  const data = await gmailFetchJson<{
    labels?: Array<{ id?: string; name?: string }>;
  }>("/gmail/v1/users/me/labels");
  return (data.labels ?? [])
    .filter((l) => l.id && l.name)
    .map((l) => ({ id: l.id!, name: l.name! }));
}

export type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailMessagePart[];
  headers?: Array<{ name?: string; value?: string }>;
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
  labelIds?: string[];
};

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

function headerOf(
  payload: GmailMessagePart | undefined,
  name: string,
): string | null {
  const h = payload?.headers?.find(
    (x) => x.name?.toLowerCase() === name.toLowerCase(),
  );
  return h?.value?.trim() || null;
}

function collectParts(
  part: GmailMessagePart | undefined,
  out: { plain: string[]; html: string[]; attachments: Array<{
    filename: string | null;
    mimeType: string | null;
    size: number | null;
  }> },
): void {
  if (!part) return;
  const mime = part.mimeType ?? "";
  if (part.filename && part.body?.attachmentId) {
    out.attachments.push({
      filename: part.filename,
      mimeType: mime || null,
      size: part.body.size ?? null,
    });
  }
  if (part.body?.data) {
    const text = decodeBase64Url(part.body.data);
    if (mime.startsWith("text/plain")) out.plain.push(text);
    else if (mime.startsWith("text/html")) out.html.push(text);
  }
  for (const child of part.parts ?? []) collectParts(child, out);
}

export function extractMailContent(message: GmailMessage): {
  subject: string | null;
  from: string | null;
  replyTo: string | null;
  plainText: string | null;
  htmlText: string | null;
  receivedAt: string;
  attachments: Array<{
    filename: string | null;
    mimeType: string | null;
    size: number | null;
  }>;
} {
  const collected = {
    plain: [] as string[],
    html: [] as string[],
    attachments: [] as Array<{
      filename: string | null;
      mimeType: string | null;
      size: number | null;
    }>,
  };
  collectParts(message.payload, collected);
  const internal = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : new Date().toISOString();
  return {
    subject: headerOf(message.payload, "Subject"),
    from: headerOf(message.payload, "From"),
    replyTo: headerOf(message.payload, "Reply-To"),
    plainText: collected.plain.join("\n\n") || null,
    htmlText: collected.html.join("\n\n") || null,
    receivedAt: internal,
    attachments: collected.attachments,
  };
}

export async function getGmailMessage(messageId: string): Promise<GmailMessage> {
  const q = new URLSearchParams({ format: "full" });
  return gmailFetchJson<GmailMessage>(
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?${q}`,
  );
}
