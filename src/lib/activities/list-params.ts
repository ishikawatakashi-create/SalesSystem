import type { ActivityListQuery, ActivityListSortKey } from "@/lib/activities/types";

export const ACTIVITY_LIST_PER_PAGE = 50;

const SORT_KEYS: ActivityListSortKey[] = [
  "updated_at",
  "activity_at",
  "title",
  "created_at",
];

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_RE = PAGE_ID_RE;

export type ActivityListParams = {
  query: ActivityListQuery;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export function parseActivityListParams(params: RawParams): ActivityListParams {
  const pageRaw = Number(str(params, "page") ?? "1");
  const page =
    Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000
      ? pageRaw
      : 1;

  const sortRaw = str(params, "sort") as ActivityListSortKey | undefined;
  const sort = sortRaw && SORT_KEYS.includes(sortRaw) ? sortRaw : undefined;
  const dirRaw = str(params, "dir");
  const sortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : undefined;

  const customer = str(params, "customer");
  const deal = str(params, "deal");
  const contact = str(params, "contact");
  const category = str(params, "category");
  const createdBy = str(params, "createdBy");
  const batchId = str(params, "batch");

  const query: ActivityListQuery = {
    q: str(params, "q"),
    customerPageId:
      customer && PAGE_ID_RE.test(customer) ? customer : undefined,
    dealPageId: deal && PAGE_ID_RE.test(deal) ? deal : undefined,
    contactPageId: contact && PAGE_ID_RE.test(contact) ? contact : undefined,
    categoryId: category && PAGE_ID_RE.test(category) ? category : undefined,
    createdBy: createdBy && UUID_RE.test(createdBy) ? createdBy : undefined,
    activityAtFrom: str(params, "from"),
    activityAtTo: str(params, "to"),
    batchId: batchId || undefined,
    sort,
    sortDir,
    limit: ACTIVITY_LIST_PER_PAGE,
    offset: (page - 1) * ACTIVITY_LIST_PER_PAGE,
  };
  return { query, page };
}

export function buildActivityListSearch(
  base: RawParams,
  patch: Record<string, string | undefined>,
): string {
  const keys = [
    "q",
    "customer",
    "deal",
    "contact",
    "category",
    "createdBy",
    "from",
    "to",
    "batch",
    "sort",
    "dir",
    "page",
  ];
  const merged = new URLSearchParams();
  for (const key of keys) {
    const patched = key in patch ? patch[key] : str(base, key);
    if (patched) merged.set(key, patched);
  }
  const s = merged.toString();
  return s ? `?${s}` : "";
}
