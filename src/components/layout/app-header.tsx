"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { GlobalSearchBox } from "@/features/search/global-search-box";
import { NavDropdown } from "@/components/layout/nav-dropdown";
import { UserMenu } from "@/components/layout/user-menu";
import {
  navLinkClass,
  resolveNavGroup,
} from "@/components/layout/nav-active";

export function AppHeader({
  displayName,
  roleLabel,
  showCsv,
  showUsers,
  showSync,
  showGmail,
  showInquiries,
  inquiryNewCount = 0,
}: {
  displayName: string;
  roleLabel: string;
  showCsv: boolean;
  showUsers: boolean;
  showSync: boolean;
  showGmail?: boolean;
  showInquiries?: boolean;
  inquiryNewCount?: number;
}) {
  const pathname = usePathname() || "/";
  const group = resolveNavGroup(pathname);
  const showAdmin = showCsv || showUsers || showSync || showGmail;

  const adminItems: Array<{ href: string; label: string }> = [];
  if (showCsv) adminItems.push({ href: "/admin/imports", label: "CSV取込" });
  if (showUsers) adminItems.push({ href: "/admin/users", label: "ユーザー管理" });
  if (showSync) adminItems.push({ href: "/admin/sync", label: "同期管理" });
  if (showGmail) {
    adminItems.push({
      href: "/admin/integrations/gmail",
      label: "Gmail連携",
    });
  }

  const activityItems = [
    ...(showInquiries
      ? [{ href: "/inquiries", label: "お問い合わせ" }]
      : []),
    { href: "/activities", label: "対応履歴" },
    { href: "/actions", label: "次回アクション" },
  ];

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex min-h-12 max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-1.5">
        <Link href="/" className="shrink-0 text-sm font-bold">
          営業管理システム
        </Link>
        <nav
          aria-label="メインナビゲーション"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        >
          <Link href="/" className={navLinkClass(group === "mydesk")}>
            マイデスク
          </Link>
          <NavDropdown
            label="顧客"
            active={group === "customers"}
            items={[
              { href: "/customers", label: "顧客一覧" },
              { href: "/contacts", label: "先方担当者一覧" },
            ]}
          />
          <Link href="/deals" className={navLinkClass(group === "deals")}>
            案件
          </Link>
          <NavDropdown
            label="対応"
            active={group === "activities"}
            badgeCount={showInquiries ? inquiryNewCount : 0}
            items={activityItems}
          />
          <NavDropdown
            label="契約・クレーム"
            active={group === "contracts"}
            items={[
              { href: "/contracts", label: "契約" },
              { href: "/complaints", label: "クレーム" },
            ]}
          />
          {showAdmin && (
            <NavDropdown
              label="管理"
              active={group === "admin"}
              items={adminItems}
            />
          )}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <GlobalSearchBox />
          <UserMenu
            displayName={displayName}
            roleLabel={roleLabel}
            adminItems={adminItems}
          />
        </div>
      </div>
    </header>
  );
}
