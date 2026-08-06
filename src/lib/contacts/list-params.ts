import type {
  ContactListQuery,
  ContactListSortKey,
} from "@/lib/contacts/types";

/**
 * URL searchParams → 一覧クエリ(純粋関数)。
 * ソートキーはホワイトリスト外を無視する。
 */

export const CONTACT_LIST_PER_PAGE = 50;

const SORT_KEYS: ContactListSortKey[] = [
  "updated_at",
  "name",
  "name_kana",
  "department",
  "title",
];

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ContactListParams = {
  query: ContactListQuery;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export function parseContactListParams(params: RawParams): ContactListParams {
  const pageRaw = Number(str(params, "page") ?? "1");
  const page =
    Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000
      ? pageRaw
      : 1;

  const sortRaw = str(params, "sort") as ContactListSortKey | undefined;
  const sort = sortRaw && SORT_KEYS.includes(sortRaw) ? sortRaw : undefined;
  const dirRaw = str(params, "dir");
  const sortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : undefined;

  const customer = str(params, "customer");
  const type = str(params, "type");
  const inactive = str(params, "inactive");

  const query: ContactListQuery = {
    q: str(params, "q"),
    customerPageId:
      customer && PAGE_ID_RE.test(customer) ? customer : undefined,
    contactTypeId: type && PAGE_ID_RE.test(type) ? type : undefined,
    // inactive=1 で無効のみ。省略時は有効のみ(listContacts側の既定)
    isActive: inactive === "1" ? false : true,
    sort,
    sortDir,
    limit: CONTACT_LIST_PER_PAGE,
    offset: (page - 1) * CONTACT_LIST_PER_PAGE,
  };
  return { query, page };
}

/** 現在の条件を維持したまま一部を差し替えたクエリ文字列を作る */
export function buildContactListSearch(
  base: RawParams,
  patch: Record<string, string | undefined>,
): string {
  const keys = ["q", "customer", "type", "inactive", "sort", "dir", "page"];
  const merged = new URLSearchParams();
  for (const key of keys) {
    const patched = key in patch ? patch[key] : str(base, key);
    if (patched) merged.set(key, patched);
  }
  const s = merged.toString();
  return s ? `?${s}` : "";
}
