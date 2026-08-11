import { AppHeader } from "@/components/layout/app-header";
import { ContextHelpSlot } from "@/features/help/context-help-slot";
import { redirect } from "next/navigation";
import { requireUser, AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getAppRoleLabel } from "@/lib/auth/role-labels";
import type { AppUserRow } from "@/types/database";
import { countNewInquiries } from "@/lib/inquiries/read-list";

export default async function MainLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let user: AppUserRow;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthError && e.code === "unauthenticated") {
      redirect("/login");
    }
    if (e instanceof AuthError) {
      redirect(`/auth/signout?error=${e.code}`);
    }
    throw e;
  }

  const showInquiries = hasPermission(user.role, "inquiry.view");
  let inquiryNewCount = 0;
  if (showInquiries) {
    try {
      inquiryNewCount = await countNewInquiries();
    } catch {
      inquiryNewCount = 0;
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader
        displayName={user.display_name}
        roleLabel={getAppRoleLabel(user.role)}
        showCsv={hasPermission(user.role, "csv.import")}
        showUsers={hasPermission(user.role, "user.manage")}
        showSync={hasPermission(user.role, "sync.manage")}
        showGmail={hasPermission(user.role, "settings.manage")}
        showInquiries={showInquiries}
        showProspects={hasPermission(user.role, "prospect.view")}
        showCallQueue={hasPermission(user.role, "prospect.call")}
        inquiryNewCount={inquiryNewCount}
      />
      <main className="mx-auto max-w-7xl p-4">
        <ContextHelpSlot />
        {children}
      </main>
    </div>
  );
}
