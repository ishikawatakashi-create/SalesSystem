export { HELP_CATEGORIES, getHelpCategory } from "@/lib/help/categories";
export {
  HELP_ARTICLES,
  getHelpArticle,
  listHelpArticles,
  listFeaturedArticles,
} from "@/lib/help/articles";
export { HELP_FAQS, getHelpFaq, listHelpFaqs } from "@/lib/help/faq";
export { HELP_TERMS, getHelpTerm } from "@/lib/help/terminology";
export { HELP_SCREEN_GUIDES, findScreenGuide } from "@/lib/help/screens";
export { searchHelpContent } from "@/lib/help/search";
export type {
  HelpArticle,
  HelpAudience,
  HelpCategory,
  HelpCategoryId,
  HelpFaqItem,
  HelpScreenGuide,
  HelpTerm,
} from "@/lib/help/types";
export type { HelpSearchHit } from "@/lib/help/search";
