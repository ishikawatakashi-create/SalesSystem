/** ルートセグメントからナビグループを判定 */
export type NavGroupId =
  | "mydesk"
  | "customers"
  | "deals"
  | "activities"
  | "contracts"
  | "admin"
  | null;

export function resolveNavGroup(pathname: string): NavGroupId {
  if (!pathname || pathname === "/") return "mydesk";
  if (
    pathname.startsWith("/customers") ||
    pathname.startsWith("/contacts")
  ) {
    return "customers";
  }
  if (pathname.startsWith("/deals")) return "deals";
  if (
    pathname.startsWith("/activities") ||
    pathname.startsWith("/actions")
  ) {
    return "activities";
  }
  if (
    pathname.startsWith("/contracts") ||
    pathname.startsWith("/complaints")
  ) {
    return "contracts";
  }
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/search")) return null;
  return null;
}

export function navLinkClass(active: boolean): string {
  return active
    ? "border-b-2 border-slate-800 pb-0.5 font-semibold text-slate-900"
    : "border-b-2 border-transparent pb-0.5 text-slate-600 hover:text-slate-900";
}
