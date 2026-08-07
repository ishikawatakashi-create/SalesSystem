import type { ActionListQuery, ActionListSortKey } from "@/lib/actions/types";
import { todayDateTokyo } from "@/lib/normalize/date-tokyo";

export const ACTION_LIST_PER_PAGE = 50;

export type ActionListView =
  | "today-overdue"
  | "upcoming"
  | "done"
  | "all";

const SORT_KEYS: ActionListSortKey[] = [
  "updated_at",
  "due_date",
  "title",
  "completed_at",
];

const VIEWS: ActionListView[] = [
  "today-overdue",
  "upcoming",
  "done",
  "all",
];

const PAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_RE = PAGE_ID_RE;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ActionListParams = {
  query: ActionListQuery;
  page: number;
  view: ActionListView;
};

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() ? s.trim() : undefined;
}

/** YYYY-MM-DD に日数を加算(暦日・日本はDSTなし) */
function addDaysYmd(ymd: string, delta: number): string {
  const parts = ymd.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const utc = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  const dt = new Date(utc);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function parseActionListParams(params: RawParams): ActionListParams {
  const pageRaw = Number(str(params, "page") ?? "1");
  const page =
    Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000
      ? pageRaw
      : 1;

  const sortRaw = str(params, "sort") as ActionListSortKey | undefined;
  const sort = sortRaw && SORT_KEYS.includes(sortRaw) ? sortRaw : undefined;
  const dirRaw = str(params, "dir");
  const sortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : undefined;

  const viewRaw = str(params, "view") as ActionListView | undefined;
  const view =
    viewRaw && VIEWS.includes(viewRaw) ? viewRaw : "today-overdue";

  const customer = str(params, "customer");
  const deal = str(params, "deal");
  const activity = str(params, "activity");
  const assignee = str(params, "assignee");
  const staff = str(params, "staff");
  const status = str(params, "status");
  const priority = str(params, "priority");
  const openRaw = str(params, "open");
  const dueFrom = str(params, "dueFrom");
  const dueTo = str(params, "dueTo");

  const today = todayDateTokyo();
  const tomorrow = addDaysYmd(today, 1);

  let isOpen: boolean | undefined =
    openRaw === "1" || openRaw === "true"
      ? true
      : openRaw === "0" || openRaw === "false"
        ? false
        : undefined;
  let dueDateFrom = dueFrom && DATE_RE.test(dueFrom) ? dueFrom : undefined;
  let dueDateTo = dueTo && DATE_RE.test(dueTo) ? dueTo : undefined;
  let resolvedSort = sort;
  let resolvedSortDir: "asc" | "desc" | undefined = sortDir;

  // タブ既定条件(明示フィルタが無いときのみ上書き)
  if (openRaw === undefined && dueFrom === undefined && dueTo === undefined) {
    if (view === "today-overdue") {
      isOpen = true;
      dueDateTo = today;
      if (!resolvedSort) {
        resolvedSort = "due_date";
        resolvedSortDir = resolvedSortDir ?? "asc";
      }
    } else if (view === "upcoming") {
      isOpen = true;
      dueDateFrom = tomorrow;
      if (!resolvedSort) {
        resolvedSort = "due_date";
        resolvedSortDir = resolvedSortDir ?? "asc";
      }
    } else if (view === "done") {
      isOpen = false;
      if (!resolvedSort) {
        resolvedSort = "completed_at";
        resolvedSortDir = resolvedSortDir ?? "desc";
      }
    }
  }

  const query: ActionListQuery = {
    q: str(params, "q"),
    customerPageId:
      customer && PAGE_ID_RE.test(customer) ? customer : undefined,
    dealPageId: deal && PAGE_ID_RE.test(deal) ? deal : undefined,
    activityPageId:
      activity && PAGE_ID_RE.test(activity) ? activity : undefined,
    assigneeUserId:
      assignee && UUID_RE.test(assignee) ? assignee : undefined,
    staffPageId: staff && PAGE_ID_RE.test(staff) ? staff : undefined,
    statusId: status && PAGE_ID_RE.test(status) ? status : undefined,
    priorityId: priority && PAGE_ID_RE.test(priority) ? priority : undefined,
    isOpen,
    dueDateFrom,
    dueDateTo,
    sort: resolvedSort,
    sortDir: resolvedSortDir,
    limit: ACTION_LIST_PER_PAGE,
    offset: (page - 1) * ACTION_LIST_PER_PAGE,
  };
  return { query, page, view };
}

export function buildActionListSearch(
  base: RawParams,
  patch: Record<string, string | undefined>,
): string {
  const keys = [
    "q",
    "customer",
    "deal",
    "activity",
    "assignee",
    "staff",
    "status",
    "priority",
    "open",
    "dueFrom",
    "dueTo",
    "view",
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
