import type { AppRole } from "@/types/database";

/**
 * 権限マトリクスの単一情報源。
 * docs/permissions.md の権限マトリクスと常に一致させること(乖離はレビューで却下)。
 */
export const PERMISSIONS = {
  "customer.view": ["admin", "a", "b", "viewer"],
  "customer.edit": ["admin", "a", "b"],
  "contact.edit": ["admin", "a", "b"],
  "deal.edit": ["admin", "a", "b"],
  "activity.edit": ["admin", "a", "b"],
  "activity.bulk_create": ["admin", "a", "b"],
  "action.edit": ["admin", "a", "b"],
  "contract.edit": ["admin", "a", "b"],
  "complaint.edit": ["admin", "a", "b"],
  "inquiry.view": ["admin", "a", "b", "viewer"],
  "inquiry.edit": ["admin", "a", "b"],
  "bulk.update": ["admin", "a"],
  "csv.import": ["admin", "a"],
  "csv.export": ["admin", "a"],
  "audit.view": ["admin", "a"],
  "sync.manage": ["admin"],
  "master.manage": ["admin"],
  "user.manage": ["admin"],
  "settings.manage": ["admin"],
} as const satisfies Record<string, readonly AppRole[]>;

export type PermissionAction = keyof typeof PERMISSIONS;

export function hasPermission(role: AppRole, action: PermissionAction): boolean {
  return (PERMISSIONS[action] as readonly AppRole[]).includes(role);
}
