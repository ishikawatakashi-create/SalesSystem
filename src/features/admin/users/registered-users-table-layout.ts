export const USER_TABLE_SCROLL_THRESHOLD = 10;

const USER_TABLE_MAX_HEIGHT_CLASS =
  "max-h-[min(29rem,calc(100vh-12rem))]";

export function shouldScrollUserTable(userCount: number): boolean {
  return userCount > USER_TABLE_SCROLL_THRESHOLD;
}

export function getUserTableContainerClass(input: {
  nested: boolean;
  userCount: number;
}): string {
  const frameClass = input.nested
    ? ""
    : "rounded border border-slate-200 bg-white";
  const overflowClass = shouldScrollUserTable(input.userCount)
    ? `${USER_TABLE_MAX_HEIGHT_CLASS} overflow-auto`
    : "overflow-x-auto";

  return `${overflowClass} ${frameClass}`.trim();
}

export function getUserTableHeaderClass(userCount: number): string {
  const stickyClass = shouldScrollUserTable(userCount)
    ? "sticky top-0 z-10"
    : "";

  return `${stickyClass} border-b border-slate-200 bg-slate-50 text-slate-500`.trim();
}
