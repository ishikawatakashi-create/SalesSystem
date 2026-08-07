const MAX_BODY_CHARS = 20_000;

/** HTML から script/style を除き plain text を抽出（表示用。XSS用に HTML は返さない） */
export function htmlToPlainText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[ \t]{2,}/g, " ").trim();
  return truncateBody(s);
}

export function truncateBody(text: string, max = MAX_BODY_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(本文を省略)`;
}

export { MAX_BODY_CHARS };
