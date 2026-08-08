/**
 * Gmail 返信下書き本文の固定テンプレート（純関数）。
 */

export function normalizeReplySubject(originalSubject: string | null | undefined): string {
  const s = (originalSubject ?? "").trim() || "お問い合わせ";
  if (/^re\s*:/i.test(s)) return s;
  return `Re: ${s}`;
}

export function quoteMessageText(messageText: string | null | undefined): string {
  const raw = (messageText ?? "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return ">";
  return raw
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function buildInquiryReplyDraftBody(input: {
  companyName: string | null | undefined;
  senderName: string | null | undefined;
  actorDisplayName: string;
  messageText: string | null | undefined;
}): string {
  const company = (input.companyName ?? "").trim();
  const hasCompany =
    company.length > 0 && company !== "/" && company !== "-" && company !== "—";
  const name = (input.senderName ?? "").trim() || "ご担当者";
  const actor = input.actorDisplayName.trim() || "担当";
  const quoted = quoteMessageText(input.messageText);

  const lines: string[] = [];
  if (hasCompany) lines.push(company);
  lines.push(`${name}様`);
  lines.push("");
  lines.push("");
  lines.push(
    `お世話になっております、株式会社イルの${actor}です。`,
  );
  lines.push("この度はお問い合わせいただきありがとうございます。");
  lines.push("");
  lines.push("");
  lines.push(quoted);
  return lines.join("\n");
}
