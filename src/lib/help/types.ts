export type HelpCategoryId =
  | "getting-started"
  | "organizations"
  | "inquiries"
  | "sales"
  | "activities"
  | "deals"
  | "contracts"
  | "search"
  | "permissions"
  | "admin";

export type HelpAudience = "all" | "editor" | "ops" | "admin";

export type HelpArticle = {
  slug: string;
  title: string;
  category: HelpCategoryId;
  summary: string;
  steps?: string[];
  tips?: string[];
  keywords: string[];
  related: string[];
  /** よくある操作トップに出す */
  featured?: boolean;
  audience?: HelpAudience;
  body?: string[];
};

export type HelpFaqItem = {
  id: string;
  category: HelpCategoryId;
  question: string;
  answer: string[];
  keywords: string[];
  related?: string[];
};

export type HelpTerm = {
  id: string;
  term: string;
  short: string;
  detail: string[];
  related?: string[];
};

export type HelpScreenGuide = {
  id: string;
  /** pathname prefix match */
  pathPrefixes: string[];
  title: string;
  summary: string;
  steps: string[];
  tips?: string[];
  articleSlug?: string;
};

export type HelpCategory = {
  id: HelpCategoryId;
  label: string;
  description: string;
  adminOnly?: boolean;
};
