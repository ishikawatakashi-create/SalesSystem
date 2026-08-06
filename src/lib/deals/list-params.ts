import type { DealListQuery, DealListSortKey } from "@/lib/deals/types";

/**
 * URL searchParams → 一覧クエリ(純粋関数)。
 * ソートキーはホワイトリスト外を無視する。
 */

export const DEAL_LIST_PER_PAGE = 50;

const SORT_KEYS: DealListSortKey[] = [
  "updated_at",
  "title",
  "expected_amount",
  "expected_close_date",
  "contracted_at",
  "probability",
];

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_RE = PAGE_ID_RE;

export type DealListParams = {
  query: DealListQuery;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export function parseDealListParams(params: RawParams): DealListParams {
  const pageRaw = Number(str(params, "page") ?? "1");
  const page =
    Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000
      ? pageRaw
      : 1;

  const sortRaw = str(params, "sort") as DealListSortKey | undefined;
  const sort = sortRaw && SORT_KEYS.includes(sortRaw) ? sortRaw : undefined;
  const dirRaw = str(params, "dir");
  const sortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : undefined;

  const customer = str(params, "customer");
  const stage = str(params, "stage");
  const status = str(params, "status");
  const semantic = str(params, "semantic");
  const staff = str(params, "staff");

  const amountMin = parseNonNegInt(str(params, "amountMin"));
  const amountMax = parseNonNegInt(str(params, "amountMax"));
  const closeFrom = parseDateOnly(str(params, "closeFrom"));
  const closeTo = parseDateOnly(str(params, "closeTo"));
  const contractedFrom = parseDateOnly(str(params, "contractedFrom"));
  const contractedTo = parseDateOnly(str(params, "contractedTo"));

  const query: DealListQuery = {
    q: str(params, "q"),
    customerPageId:
      customer && PAGE_ID_RE.test(customer) ? customer : undefined,
    stageId: stage && PAGE_ID_RE.test(stage) ? stage : undefined,
    statusId: status && PAGE_ID_RE.test(status) ? status : undefined,
    statusSemantic: semantic || undefined,
    staffUserId: staff && UUID_RE.test(staff) ? staff : undefined,
    expectedAmountMin: amountMin,
    expectedAmountMax: amountMax,
    expectedCloseDateFrom: closeFrom,
    expectedCloseDateTo: closeTo,
    contractedAtFrom: contractedFrom,
    contractedAtTo: contractedTo,
    sort,
    sortDir,
    limit: DEAL_LIST_PER_PAGE,
    offset: (page - 1) * DEAL_LIST_PER_PAGE,
  };
  return { query, page };
}

function parseNonNegInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) return undefined;
  return n;
}

function parseDateOnly(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  return raw;
}

/** 現在の条件を維持したまま一部を差し替えたクエリ文字列を作る */
export function buildDealListSearch(
  base: RawParams,
  patch: Record<string, string | undefined>,
): string {
  const keys = [
    "q",
    "customer",
    "stage",
    "status",
    "semantic",
    "staff",
    "amountMin",
    "amountMax",
    "closeFrom",
    "closeTo",
    "contractedFrom",
    "contractedTo",
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
