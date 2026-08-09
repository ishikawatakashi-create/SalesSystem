/**
 * docs/user-guide/faq.md を HELP_FAQS から生成する（内容の二重管理を減らす）。
 * 実行: npx tsx scripts/generate-user-guide-faq.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { HELP_FAQS } from "../src/lib/help/faq";
import { HELP_CATEGORIES } from "../src/lib/help/categories";

const lines: string[] = [
  "# SalesSystem FAQ",
  "",
  "やりたいことから探すQ&Aです。アプリ内でも `/help/faq` で同じ内容を検索できます。",
  "",
  "構造化データの正本: `src/lib/help/faq.ts`",
  "",
];

const byCat = new Map<string, typeof HELP_FAQS>();
for (const faq of HELP_FAQS) {
  const list = byCat.get(faq.category) ?? [];
  list.push(faq);
  byCat.set(faq.category, list);
}

for (const cat of HELP_CATEGORIES) {
  const items = byCat.get(cat.id);
  if (!items?.length) continue;
  lines.push(`## ${cat.label}`, "");
  for (const faq of items) {
    lines.push(`### Q. ${faq.question}`, "");
    for (const [i, a] of faq.answer.entries()) {
      lines.push(i === 0 ? `A. ${a}` : a, "");
    }
    if (faq.related?.length) {
      lines.push(`関連記事（アプリ）: ${faq.related.map((s) => `/help/${s}`).join(", ")}`, "");
    }
  }
}

const out = join(process.cwd(), "docs/user-guide/faq.md");
writeFileSync(out, lines.join("\n"), "utf8");
console.log(`Wrote ${out} (${HELP_FAQS.length} FAQs)`);
