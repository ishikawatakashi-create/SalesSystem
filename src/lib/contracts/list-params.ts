import type { ContractListQuery, ContractListSortKey } from "@/lib/contracts/types";

export const CONTRACT_LIST_PER_PAGE = 50;

const SORT_KEYS: ContractListSortKey[] = [
  "updated_at",
  "title",
  "contracted_at",
  "start_date",
  "end_date",
  "amount",
];

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_RE = PAGE_ID_RE;

export type ContractListParams = {
  query: ContractListQuery;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

export function parseContractListParams(params: RawParams): ContractListParams {
  const pageRaw = Number(str(params, "page") ?? "1");
  const page =
    Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000
      ? pageRaw
      : 1;

  const sortRaw = str(params, "sort") as ContractListSortKey | undefined;
  const sort = sortRaw && SORT_KEYS.includes(sortRaw) ? sortRaw : undefined;
  const dirRaw = str(params, "dir");
  const sortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : undefined;

  const customer = str(params, "customer");
  const deal = str(params, "deal");
  const trade = str(params, "trade");
  const status = str(params, "status");
  const semantic = str(params, "semantic");
  const payment = str(params, "payment");
  const staff = str(params, "staff");

  const query: ContractListQuery = {
    q: str(params, "q"),
    customerPageId:
      customer && PAGE_ID_RE.test(customer) ? customer : undefined,
    dealPageId: deal && PAGE_ID_RE.test(deal) ? deal : undefined,
    tradeTypeId: trade && PAGE_ID_RE.test(trade) ? trade : undefined,
    statusId: status && PAGE_ID_RE.test(status) ? status : undefined,
    statusSemantic: semantic || undefined,
    paymentStatusId: payment && PAGE_ID_RE.test(payment) ? payment : undefined,
    staffUserId: staff && UUID_RE.test(staff) ? staff : undefined,
    endDateFrom: parseDateOnly(str(params, "endFrom")),
    endDateTo: parseDateOnly(str(params, "endTo")),
    contractedAtFrom: parseDateOnly(str(params, "contractedFrom")),
    contractedAtTo: parseDateOnly(str(params, "contractedTo")),
    amountMin: parseNonNegInt(str(params, "amountMin")),
    amountMax: parseNonNegInt(str(params, "amountMax")),
    sort,
    sortDir,
    limit: CONTRACT_LIST_PER_PAGE,
    offset: (page - 1) * CONTRACT_LIST_PER_PAGE,
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

export function buildContractListSearch(
  base: RawParams,
  patch: Record<string, string | undefined>,
): string {
  const keys = [
    "q",
    "customer",
    "deal",
    "trade",
    "status",
    "semantic",
    "payment",
    "staff",
    "endFrom",
    "endTo",
    "contractedFrom",
    "contractedTo",
    "amountMin",
    "amountMax",
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
