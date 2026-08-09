import { HELP_ARTICLES } from "@/lib/help/articles";
import { HELP_FAQS } from "@/lib/help/faq";
import { HELP_TERMS } from "@/lib/help/terminology";
import type { HelpArticle, HelpFaqItem, HelpTerm } from "@/lib/help/types";

export type HelpSearchHit =
  | { kind: "article"; item: HelpArticle; score: number }
  | { kind: "faq"; item: HelpFaqItem; score: number }
  | { kind: "term"; item: HelpTerm; score: number };

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function scoreText(haystack: string, needle: string): number {
  const h = normalize(haystack);
  const n = normalize(needle);
  if (!n) return 0;
  if (h === n) return 100;
  if (h.startsWith(n)) return 80;
  if (h.includes(n)) return 50;
  return 0;
}

function scoreFields(fields: string[], query: string): number {
  let best = 0;
  for (const field of fields) {
    best = Math.max(best, scoreText(field, query));
  }
  // 単語分割（空白区切り）も見る
  const parts = query.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    let all = 0;
    for (const p of parts) {
      const s = Math.max(...fields.map((f) => scoreText(f, p)));
      if (s === 0) return best;
      all += s;
    }
    best = Math.max(best, Math.floor(all / parts.length));
  }
  return best;
}

export function searchHelpContent(
  query: string,
  options?: { includeAdmin?: boolean; limit?: number },
): HelpSearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const includeAdmin = options?.includeAdmin ?? false;
  const limit = options?.limit ?? 20;
  const hits: HelpSearchHit[] = [];

  for (const article of HELP_ARTICLES) {
    if (article.category === "admin" && !includeAdmin) continue;
    const score = scoreFields(
      [
        article.title,
        article.summary,
        ...article.keywords,
        ...(article.steps ?? []),
        ...(article.body ?? []),
        ...(article.tips ?? []),
      ],
      q,
    );
    if (score > 0) hits.push({ kind: "article", item: article, score });
  }

  for (const faq of HELP_FAQS) {
    if (faq.category === "admin" && !includeAdmin) continue;
    const score = scoreFields(
      [faq.question, ...faq.answer, ...faq.keywords],
      q,
    );
    if (score > 0) hits.push({ kind: "faq", item: faq, score });
  }

  for (const term of HELP_TERMS) {
    const score = scoreFields(
      [term.term, term.short, ...term.detail],
      q,
    );
    if (score > 0) hits.push({ kind: "term", item: term, score });
  }

  hits.sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind));
  return hits.slice(0, limit);
}
