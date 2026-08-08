import { htmlToPlainText, truncateBody } from "@/lib/inquiries/html-text";
import type { InquiryParseStatus, InquirySourceConfidence } from "@/lib/inquiries/types";

/** 現行 Strikingly カスタムフォーム向け parser 版 */
export const STRIKINGLY_PARSER_VERSION = 2;

export type ParsedStrikinglyMail = {
  senderName: string | null;
  senderKana: string | null;
  senderEmail: string | null;
  replyToEmail: string | null;
  phone: string | null;
  companyName: string | null;
  department: string | null;
  inquiryType: string | null;
  formName: string | null;
  subject: string | null;
  messageText: string | null;
  formFields: Record<string, string>;
  parseStatus: InquiryParseStatus;
  parseWarningCode: string | null;
  sourceConfidence: InquirySourceConfidence;
  parserVersion: number;
};

export type StrikinglyParseInput = {
  subject?: string | null;
  from?: string | null;
  replyTo?: string | null;
  plainText?: string | null;
  htmlText?: string | null;
};

const SOURCE_SUBJECT_RE = /^.+\sはあなたのサイトにコメントしました\s*$/;
const REPLY_FWD_SUBJECT_RE = /^(re|fw|fwd)\s*:/i;

const FOOTER_MARKERS = [
  "このメールを返信して",
  "すべての返事を読む",
  "reply to this email",
  "view all responses",
  "commented on your site",
];

const LABEL_DEFS: Array<{
  key: string;
  labels: string[];
  multiline?: boolean;
}> = [
  { key: "inquiryType", labels: ["お問い合わせ種別"] },
  { key: "name", labels: ["名前", "お名前", "氏名", "名", "Name", "Your Name"] },
  { key: "kana", labels: ["フリガナ", "ふりがな", "カナ"] },
  { key: "company", labels: ["会社名", "会社", "組織", "Company", "Organization"] },
  { key: "department", labels: ["部署名", "部署", "Department"] },
  { key: "email", labels: ["メールアドレス", "メール", "Email", "E-mail", "E-Mail"] },
  { key: "phone", labels: ["電話番号", "電話", "Tel", "Phone", "携帯"] },
  {
    key: "message",
    labels: ["お問い合わせ内容", "問い合わせ内容", "メッセージ", "Message", "Comment", "Comments"],
    multiline: true,
  },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nullIfEmpty(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  if (!t || t === "/" || t === "-" || t === "—" || t === "－") return null;
  return t;
}

function extractEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angle = raw.match(/<([^>]+@[^>]+)>/);
  const angled = angle?.[1];
  if (angled) return angled.trim().toLowerCase();
  const bare = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const bareAddr = bare?.[0];
  return bareAddr ? bareAddr.toLowerCase() : null;
}

export function isReplyOrForwardSubject(subject?: string | null): boolean {
  return REPLY_FWD_SUBJECT_RE.test((subject ?? "").trim());
}

/** 件名だけでの元通知判定（問い合わせ者メールドメインは見ない） */
export function isStrikinglySourceSubject(subject?: string | null): boolean {
  const s = (subject ?? "").trim();
  if (!s || isReplyOrForwardSubject(s)) return false;
  return SOURCE_SUBJECT_RE.test(s);
}

export function hasLabelSentinel(body: string, label: string): boolean {
  const re = new RegExp(
    `(^|\\n)\\s*${escapeRegExp(label)}\\s*[:：]?\\s*($|\\n)`,
    "i",
  );
  return re.test(body);
}

/** 旧ゆるい判定（互換・テスト用）。取込ゲートには isStrikinglySourceNotification を使う */
export function looksLikeStrikinglyNotification(input: {
  subject?: string | null;
  from?: string | null;
  body?: string | null;
}): boolean {
  return isStrikinglySourceNotification(input);
}

/**
 * 正規の Strikingly 元通知か（最終ゲート）。
 * From だけでは判定しない。Re/Fwd は除外。
 */
export function isStrikinglySourceNotification(input: {
  subject?: string | null;
  from?: string | null;
  body?: string | null;
}): boolean {
  // from / 問い合わせ者メールドメインは判定に使わない
  if (!isStrikinglySourceSubject(input.subject)) return false;

  const body = input.body ?? "";
  const required = [
    "カスタムフォーム",
    "お問い合わせ種別",
    "名",
    "メールアドレス",
    "お問い合わせ内容",
  ];
  return required.every((label) => hasLabelSentinel(body, label));
}

function countSourceSentinels(body: string): number {
  const labels = [
    "カスタムフォーム",
    "お問い合わせ種別",
    "名",
    "フリガナ",
    "会社名",
    "部署名",
    "メールアドレス",
    "お問い合わせ内容",
  ];
  return labels.reduce(
    (n, label) => n + (hasLabelSentinel(body, label) ? 1 : 0),
    0,
  );
}

/** plain が欠落している場合に HTML 由来テキストを優先 */
export function selectParseBody(plain: string, fromHtml: string): string {
  const p = plain.trim();
  const h = fromHtml.trim();
  const ps = countSourceSentinels(p);
  const hs = countSourceSentinels(h);
  if (hs > ps) return h;
  if (ps > 0) return p;
  // sentinel が無い場合でも HTML の方が明らかに長いなら HTML を試す
  if (h.length > p.length * 2 && h.length > 200) return h;
  return p || h;
}

function stripFooter(text: string): string {
  let cut = text.length;
  const lower = text.toLowerCase();
  for (const marker of FOOTER_MARKERS) {
    const idx = lower.indexOf(marker.toLowerCase());
    if (idx >= 0 && idx < cut) cut = idx;
  }
  return text.slice(0, cut).trim();
}

function stripHeaderNoise(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/はあなたのサイトにコメントしました\s*$/.test(t)) continue;
    if (/commented on your site/i.test(t)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

function matchLabelLine(
  line: string,
): { key: string; inlineValue: string; multiline?: boolean } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  for (const def of LABEL_DEFS) {
    for (const label of def.labels) {
      const re = new RegExp(`^${escapeRegExp(label)}\\s*[:：]?\\s*(.*)$`, "i");
      const m = trimmed.match(re);
      if (!m) continue;
      // 「名」が「名前」等のプレフィックスに誤爆しないよう、完全一致ラベルを優先済み
      // 「内容」単独はお問い合わせ内容の部分一致を避けるため LABEL_DEFS に入れない
      const inline = (m[1] ?? "").trim();
      return { key: def.key, inlineValue: inline, multiline: def.multiline };
    }
  }
  return null;
}

function isKnownLabelLine(line: string): boolean {
  return matchLabelLine(line) != null || /^\s*カスタムフォーム\s*$/i.test(line);
}

function parseLabeledFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i] ?? "";
    const matched = matchLabelLine(rawLine);
    if (!matched) {
      i += 1;
      continue;
    }

    let value = matched.inlineValue;
    if (!value && i + 1 < lines.length) {
      const next = (lines[i + 1] ?? "").trim();
      if (next && !isKnownLabelLine(next)) {
        value = next;
        i += 1;
      }
    }

    if (matched.multiline) {
      const rest: string[] = [];
      if (value) rest.push(value);
      while (i + 1 < lines.length) {
        const peekRaw = lines[i + 1] ?? "";
        const peek = peekRaw.trim();
        if (!peek) {
          rest.push("");
          i += 1;
          continue;
        }
        if (isKnownLabelLine(peek)) break;
        if (FOOTER_MARKERS.some((m) => peek.toLowerCase().includes(m.toLowerCase()))) {
          break;
        }
        rest.push(peekRaw.trimEnd());
        i += 1;
      }
      value = rest.join("\n").trim();
    }

    const normalized = nullIfEmpty(value);
    if (normalized) fields[matched.key] = normalized;
    i += 1;
  }
  return fields;
}

/**
 * Strikingly 問い合わせ通知メールのパーサ。
 * HTML は sanitize 済み plain 化して使用。HTML 自体は返さない。
 */
export function parseStrikinglyNotificationMail(
  input: StrikinglyParseInput,
): ParsedStrikinglyMail {
  const subject = input.subject?.trim() || null;
  const from = input.from?.trim() || "";
  const replyTo = input.replyTo?.trim() || "";
  const plain = truncateBody((input.plainText ?? "").trim());
  const fromHtml = input.htmlText ? htmlToPlainText(input.htmlText) : "";
  const selected = selectParseBody(plain, fromHtml);
  const body = stripFooter(stripHeaderNoise(selected));

  const fields = body ? parseLabeledFields(body) : {};
  const replyToEmail = extractEmail(replyTo);

  const fieldEmail = nullIfEmpty(fields.email)?.toLowerCase() ?? null;
  const senderEmail = fieldEmail || replyToEmail || null;

  const senderName = nullIfEmpty(fields.name);
  const senderKana = nullIfEmpty(fields.kana);
  const companyName = nullIfEmpty(fields.company);
  const department = nullIfEmpty(fields.department);
  const inquiryType = nullIfEmpty(fields.inquiryType);
  const phone = nullIfEmpty(fields.phone);

  const hasCustomFormHeader = hasLabelSentinel(selected, "カスタムフォーム");
  const formName = inquiryType || (hasCustomFormHeader ? "カスタムフォーム" : null);

  let messageText = nullIfEmpty(fields.message);
  if (messageText) {
    messageText = stripFooter(messageText);
  }

  const strikinglyLike = isStrikinglySourceNotification({
    subject: subject ?? "",
    from,
    body: selected,
  });

  let parseStatus: InquiryParseStatus = "ok";
  let parseWarningCode: string | null = null;
  let sourceConfidence: InquirySourceConfidence = "medium";

  if (!selected) {
    parseStatus = "warning";
    parseWarningCode = "empty_body";
    sourceConfidence = "low";
  } else if (!strikinglyLike) {
    parseStatus = "warning";
    parseWarningCode = "unknown_template";
    sourceConfidence = "low";
  } else if (!senderEmail && !senderName && !messageText) {
    parseStatus = "warning";
    parseWarningCode = "sparse_fields";
    sourceConfidence = "medium";
  } else if (strikinglyLike && (senderEmail || messageText)) {
    sourceConfidence = "high";
  }

  const formFields: Record<string, string> = {};
  if (senderKana) formFields["フリガナ"] = senderKana;
  if (department) formFields["部署名"] = department;
  if (inquiryType) formFields["お問い合わせ種別"] = inquiryType;
  if (hasCustomFormHeader) formFields["フォーム"] = "カスタムフォーム";

  return {
    senderName,
    senderKana,
    senderEmail,
    replyToEmail: fieldEmail || replyToEmail || senderEmail,
    phone,
    companyName,
    department,
    inquiryType,
    formName,
    subject,
    messageText,
    formFields,
    parseStatus,
    parseWarningCode,
    sourceConfidence,
    parserVersion: STRIKINGLY_PARSER_VERSION,
  };
}
