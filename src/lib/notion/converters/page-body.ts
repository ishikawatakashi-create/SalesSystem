/**
 * ページ本文ブロック操作の土台。
 * 長文はプロパティへ格納せず本文へ配置する(docs/notion-schema.md §10)。
 * 安全な追加優先更新の本実装はwrite pipeline段階。
 */

export type PageBodySection = {
  heading: string;
  paragraphs: string[];
};

export function buildHeadingSections(
  sections: PageBodySection[],
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  for (const section of sections) {
    blocks.push({
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: section.heading } }],
      },
    });
    for (const paragraph of section.paragraphs) {
      blocks.push({
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: paragraph } }],
        },
      });
    }
  }
  return blocks;
}

export function summarizeText(text: string, max = 200): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}
