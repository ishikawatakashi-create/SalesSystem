import { htmlToPlainText, truncateBody } from "@/lib/inquiries/html-text";
import type { InquiryParseStatus, InquirySourceConfidence } from "@/lib/inquiries/types";

export type ParsedStrikinglyMail = {
  senderName: string | null;
  senderEmail: string | null;
  replyToEmail: string | null;
  phone: string | null;
  companyName: string | null;
  formName: string | null;
  subject: string | null;
  messageText: string | null;
  formFields: Record<string, string>;
  parseStatus: InquiryParseStatus;
  parseWarningCode: string | null;
  sourceConfidence: InquirySourceConfidence;
};

export type StrikinglyParseInput = {
  subject?: string | null;
  from?: string | null;
  replyTo?: string | null;
  plainText?: string | null;
  htmlText?: string | null;
};

const FIELD_PATTERNS: Array<{ key: string; labels: RegExp }> = [
  {
    key: "name",
    labels: /^(名前|お名前|氏名|Name|Your\s*Name)\s*[:：]/i,
  },
  {
    key: "email",
    labels: /^(メール|メールアドレス|Email|E-?mail)\s*[:：]/i,
  },
  {
    key: "phone",
    labels: /^(電話|電話番号|Tel|Phone|携帯)\s*[:：]/i,
  },
  {
    key: "company",
    labels: /^(会社|会社名|組織|Company|Organization)\s*[:：]/i,
  },
  {
    key: "message",
    labels: /^(お問い合わせ内容|問い合わせ内容|内容|メッセージ|Message|Comments?)\s*[:：]/i,
  },
  {
    key: "form",
    labels: /^(フォーム|フォーム名|Form)\s*[:：]/i,
  },
];

function extractEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angle = raw.match(/<([^>]+@[^>]+)>/);
  const angled = angle?.[1];
  if (angled) return angled.trim().toLowerCase();
  const bare = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const bareAddr = bare?.[0];
  return bareAddr ? bareAddr.toLowerCase() : null;
}

function extractDisplayName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^\s*"?([^"<]+)"?\s*</);
  const captured = m?.[1];
  if (captured) {
    const n = captured.trim();
    return n || null;
  }
  if (raw.includes("@")) return null;
  const t = raw.trim();
  return t || null;
}

function looksLikeStrikingly(input: {
  subject: string;
  from: string;
  body: string;
}): boolean {
  const blob = `${input.subject}\n${input.from}\n${input.body}`.toLowerCase();
  if (blob.includes("strikingly")) return true;
  if (/new\s+(contact\s+)?form\s+submission/i.test(input.subject)) return true;
  if (/新しい.*フォーム|お問い合わせ.*通知|form submission/i.test(input.subject)) {
    return true;
  }
  if (/you received a new submission|フォームから送信/i.test(input.body)) {
    return true;
  }
  return false;
}

function parseLabeledFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();
    let matched = false;
    for (const fp of FIELD_PATTERNS) {
      const m = line.match(fp.labels);
      if (!m || m[0] === undefined) continue;
      matched = true;
      let value = line.slice(m[0].length).trim();
      if (!value && i + 1 < lines.length) {
        const next = (lines[i + 1] ?? "").trim();
        if (next && !FIELD_PATTERNS.some((p) => p.labels.test(next))) {
          value = next;
          i += 1;
        }
      }
      // 複数行メッセージ
      if (fp.key === "message" && value) {
        const rest: string[] = [value];
        while (i + 1 < lines.length) {
          const peek = lines[i + 1] ?? "";
          if (!peek.trim()) {
            rest.push("");
            i += 1;
            continue;
          }
          if (FIELD_PATTERNS.some((p) => p.labels.test(peek.trim()))) break;
          rest.push(peek.trimEnd());
          i += 1;
        }
        fields[fp.key] = rest.join("\n").trim();
      } else if (value) {
        fields[fp.key] = value;
      }
      break;
    }
    if (!matched) {
      // 未知ラベル: 「ラベル: 値」
      const custom = line.match(/^(.{1,40})[:：]\s*(.+)$/);
      const customLabel = custom?.[1];
      const customValue = custom?.[2];
      if (customLabel && customValue && !customLabel.includes("@")) {
        const label = customLabel.trim();
        const known = FIELD_PATTERNS.some((p) => p.labels.test(`${label}:`));
        if (!known && label.length >= 1) {
          fields[`custom:${label}`] = customValue.trim();
        }
      }
    }
    i += 1;
  }
  return fields;
}

/**
 * Strikingly 問い合わせ通知メールのゆるいパーサ。
 * テンプレート不一致でも破棄せず warning で本文を残す。
 */
export function parseStrikinglyNotificationMail(
  input: StrikinglyParseInput,
): ParsedStrikinglyMail {
  const subject = input.subject?.trim() || null;
  const from = input.from?.trim() || "";
  const replyTo = input.replyTo?.trim() || "";
  const plain = truncateBody((input.plainText ?? "").trim());
  const fromHtml = input.htmlText ? htmlToPlainText(input.htmlText) : "";
  const body = plain || fromHtml;

  const replyToEmail = extractEmail(replyTo);
  const fromEmail = extractEmail(from);
  const fields = body ? parseLabeledFields(body) : {};

  const senderEmail =
    replyToEmail ||
    fields.email?.toLowerCase() ||
    fromEmail ||
    null;

  const senderName =
    fields.name ||
    extractDisplayName(replyTo) ||
    extractDisplayName(from) ||
    null;

  const phone = fields.phone || null;
  const companyName = fields.company || null;
  const formName = fields.form || null;
  const messageText =
    fields.message ||
    (body ? body : null);

  const strikinglyLike = looksLikeStrikingly({
    subject: subject ?? "",
    from,
    body,
  });

  let parseStatus: InquiryParseStatus = "ok";
  let parseWarningCode: string | null = null;
  let sourceConfidence: InquirySourceConfidence = "medium";

  if (!body) {
    parseStatus = "warning";
    parseWarningCode = "empty_body";
    sourceConfidence = "low";
  } else if (!strikinglyLike) {
    parseStatus = "warning";
    parseWarningCode = "unknown_template";
    sourceConfidence = "low";
  } else if (!senderEmail && !senderName && !fields.message) {
    parseStatus = "warning";
    parseWarningCode = "sparse_fields";
    sourceConfidence = "medium";
  } else if (strikinglyLike && (senderEmail || fields.message)) {
    sourceConfidence = "high";
  }

  const formFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k.startsWith("custom:")) formFields[k.slice(7)] = v;
    else if (!["name", "email", "phone", "company", "message", "form"].includes(k)) {
      formFields[k] = v;
    } else if (k !== "message") {
      // 既知フィールドも form_fields に残してよい（message は message_text）
      formFields[k] = v;
    }
  }

  return {
    senderName,
    senderEmail,
    replyToEmail: replyToEmail || senderEmail,
    phone,
    companyName,
    formName,
    subject,
    messageText,
    formFields,
    parseStatus,
    parseWarningCode,
    sourceConfidence,
  };
}
