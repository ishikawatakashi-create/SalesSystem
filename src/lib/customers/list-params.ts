import type {
  CustomerListQuery,
  CustomerListSortKey,
} from "@/lib/customers/types";
import { isKnownOrganizationRelationshipKey } from "@/lib/organizations/relationship";

/**
 * URL searchParams → 一覧クエリ(純粋関数)。
 * ソートキーはホワイトリスト外を無視する。
 */

export const CUSTOMER_LIST_PER_PAGE = 50;

const SORT_KEYS: CustomerListSortKey[] = [
  "updated_at",
  "display_name",
  "last_activity_at",
  "next_action_date",
  "expected_amount",
];

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_RE = PAGE_ID_RE;

export type CustomerListParams = {
  query: CustomerListQuery;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export function parseCustomerListParams(params: RawParams): CustomerListParams {
  const pageRaw = Number(str(params, "page") ?? "1");
  const page =
    Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000
      ? pageRaw
      : 1;

  const sortRaw = str(params, "sort") as CustomerListSortKey | undefined;
  const sort = sortRaw && SORT_KEYS.includes(sortRaw) ? sortRaw : undefined;
  const dirRaw = str(params, "dir");
  const sortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : undefined;

  const status = str(params, "status");
  const category = str(params, "category");
  const staff = str(params, "staff");
  const relationship = str(params, "relationship");

  const query: CustomerListQuery = {
    q: str(params, "q"),
    prefecture: str(params, "pref"),
    salesStatusId: status && PAGE_ID_RE.test(status) ? status : undefined,
    businessCategoryId:
      category && PAGE_ID_RE.test(category) ? category : undefined,
    relationshipSemanticKey:
      relationship && isKnownOrganizationRelationshipKey(relationship)
        ? relationship
        : undefined,
    staffUserId: staff && UUID_RE.test(staff) ? staff : undefined,
    // archived=1 でアーカイブ済みのみ表示(既定は非アーカイブのみ)
    isArchived: str(params, "archived") === "1",
    sort,
    sortDir,
    limit: CUSTOMER_LIST_PER_PAGE,
    offset: (page - 1) * CUSTOMER_LIST_PER_PAGE,
  };
  return { query, page };
}

/** 現在の条件を維持したまま一部を差し替えたクエリ文字列を作る */
export function buildListSearch(
  base: RawParams,
  patch: Record<string, string | undefined>,
): string {
  const keys = [
    "q",
    "status",
    "category",
    "staff",
    "pref",
    "archived",
    "sort",
    "dir",
    "page",
    "relationship",
  ];
  const merged = new URLSearchParams();
  for (const key of keys) {
    const patched = key in patch ? patch[key] : str(base, key);
    if (patched) merged.set(key, patched);
  }
  const s = merged.toString();
  return s ? `?${s}` : "";
}
