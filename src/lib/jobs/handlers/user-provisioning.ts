import "server-only";

import { createDefaultNotionClient } from "@/lib/notion/client";
import { provisionStaffPage } from "@/lib/notion/provisioning/staff";
import { SETUP_STATE_KEY, type SetupState } from "@/lib/notion/setup/apply";
import { createAdminClient } from "@/lib/supabase/admin";
import type { JobHandler } from "@/lib/jobs/types";

export const userProvisioningHandler: JobHandler = async (job, ctx) => {
  const userId = typeof job.payload.user_id === "string" ? job.payload.user_id : null;
  if (!userId) return { status: "failed", errorMessage: "user_id missing" };

  const admin = createAdminClient();
  const [{ data: user, error: userError }, { data: setting, error: settingError }] =
    await Promise.all([
      admin
        .from("app_users")
        .select("id,display_name,role,department_role,is_active,email,provisioning_status")
        .eq("id", userId)
        .maybeSingle(),
      admin
        .from("system_settings")
        .select("value")
        .eq("key", SETUP_STATE_KEY)
        .maybeSingle(),
    ]);
  if (userError || !user) {
    return { status: "failed", errorMessage: "app_user missing" };
  }
  if (user.provisioning_status === "completed") {
    return { status: "succeeded", result: { already_completed: true } };
  }
  if (settingError) {
    return { status: "retry", errorMessage: "notion setup state read failed" };
  }
  const state = setting?.value as SetupState | undefined;
  const staffDataSourceId = state?.databases?.staff?.dataSourceId;
  if (!staffDataSourceId) {
    return { status: "retry", errorMessage: "staff data source is not configured" };
  }
  if (!(await ctx.heartbeat())) {
    return { status: "retry", errorMessage: "lease lost before notion write" };
  }

  const result = await provisionStaffPage({
    notion: createDefaultNotionClient({ defaultPriority: "bulk" }),
    staffDataSourceId,
    user: {
      userId: user.id,
      displayName: user.display_name,
      role: user.role,
      departmentRole: user.department_role,
      isActive: user.is_active,
      email: user.email,
    },
    keepProfileUsableOnFailure: true,
  });
  if (result.status === "completed") {
    return { status: "succeeded", result: { provisioned: true } };
  }
  return { status: "retry", errorMessage: "staff provisioning failed" };
};
