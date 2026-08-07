import { AppHeader } from "@/components/layout/app-header";
import { redirect } from "next/navigation";
import { requireUser, AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import type { AppUserRow } from "@/types/database";

const ROLE_LABELS: Record<AppUserRow["role"], string> = {
  admin: "管理者",
  a: "営業A",
  b: "営業B",
  viewer: "閲覧",
};

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

  return (
    <div className="min-h-screen">
      <AppHeader
        displayName={user.display_name}
        roleLabel={ROLE_LABELS[user.role]}
        showCsv={hasPermission(user.role, "csv.import")}
        showUsers={hasPermission(user.role, "user.manage")}
        showSync={hasPermission(user.role, "sync.manage")}
      />
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </div>
  );
}
