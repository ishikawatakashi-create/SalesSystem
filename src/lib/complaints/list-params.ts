import type {
  ComplaintListQuery,
  ComplaintListSortKey,
} from "@/lib/complaints/types";

export const COMPLAINT_LIST_PER_PAGE = 50;

const SORT_KEYS: ComplaintListSortKey[] = [
  "updated_at",
  "occurred_on",
  "due_date",
  "title",
  "created_at",
];

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_RE = PAGE_ID_RE;

export type ComplaintListParams = {
  query: ComplaintListQuery;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export function parseComplaintListParams(
  params: RawParams,
): ComplaintListParams {
  const pageRaw = Number(str(params, "page") ?? "1");
  const page =
    Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000
      ? pageRaw
      : 1;

  const sortRaw = str(params, "sort") as ComplaintListSortKey | undefined;
  const sort = sortRaw && SORT_KEYS.includes(sortRaw) ? sortRaw : undefined;
  const dirRaw = str(params, "dir");
  const sortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : undefined;

  const customer = str(params, "customer");
  const deal = str(params, "deal");
  const severity = str(params, "severity");
  const status = str(params, "status");
  const semantic = str(params, "semantic");
  const staff = str(params, "staff");
  const unresolved = str(params, "unresolved");
  const statusId = status && PAGE_ID_RE.test(status) ? status : undefined;

  // 既定は未解決。unresolved=0/all または status 指定で全件/個別へ
  let unresolvedOnly: boolean | undefined;
  if (unresolved === "0" || unresolved === "false" || unresolved === "all") {
    unresolvedOnly = undefined;
  } else if (unresolved === "1" || unresolved === "true") {
    unresolvedOnly = true;
  } else if (!statusId && !semantic) {
    unresolvedOnly = true;
  }

  const query: ComplaintListQuery = {
    q: str(params, "q"),
    customerPageId:
      customer && PAGE_ID_RE.test(customer) ? customer : undefined,
    dealPageId: deal && PAGE_ID_RE.test(deal) ? deal : undefined,
    severityId: severity && PAGE_ID_RE.test(severity) ? severity : undefined,
    statusId,
    statusSemantic: semantic || undefined,
    unresolvedOnly,
    staffUserId: staff && UUID_RE.test(staff) ? staff : undefined,
    occurredOnFrom: parseDateOnly(str(params, "occurredFrom")),
    occurredOnTo: parseDateOnly(str(params, "occurredTo")),
    dueDateFrom: parseDateOnly(str(params, "dueFrom")),
    dueDateTo: parseDateOnly(str(params, "dueTo")),
    sort,
    sortDir,
    limit: COMPLAINT_LIST_PER_PAGE,
    offset: (page - 1) * COMPLAINT_LIST_PER_PAGE,
  };
  return { query, page };
}

function parseDateOnly(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  return raw;
}

export function buildComplaintListSearch(
  base: RawParams,
  patch: Record<string, string | undefined>,
): string {
  const keys = [
    "q",
    "customer",
    "deal",
    "severity",
    "status",
    "semantic",
    "unresolved",
    "staff",
    "occurredFrom",
    "occurredTo",
    "dueFrom",
    "dueTo",
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
