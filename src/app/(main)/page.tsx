import { redirect } from "next/navigation";

import { MyDeskView } from "@/features/mydesk/my-desk-view";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { loadMyDesk } from "@/lib/mydesk/load";

export const dynamic = "force-dynamic";

export default async function MyDeskPage() {
  let user;
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

  const snapshot = await loadMyDesk(user);
  const canEditActions = hasPermission(user.role, "action.edit");

  return (
    <MyDeskView
      snapshot={snapshot}
      user={user}
      canEditActions={canEditActions}
    />
  );
}
