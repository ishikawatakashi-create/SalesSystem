import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { validateDisplayName } from "@/lib/auth/display-name";
import type { AppUserRow } from "@/types/database";

export type UpdateDisplayNameResult =
  | { ok: true; displayName: string }
  | { ok: false; message: string };

/**
 * app_users.display_name を更新（SSoT）。
 * - admin: 任意のユーザー
 * - それ以外: 自分自身のみ
 * request の actor は session から渡すこと。
 */
export async function updateUserDisplayName(input: {
  actor: Pick<AppUserRow, "id" | "role" | "display_name">;
  targetUserId: string;
  displayName: string;
}): Promise<UpdateDisplayNameResult> {
  const validated = validateDisplayName(input.displayName);
  if (!validated.ok) return validated;

  const isAdmin = input.actor.role === "admin";
  if (!isAdmin && input.actor.id !== input.targetUserId) {
    return {
      ok: false,
      message: "他のユーザーの表示名は変更できません",
    };
  }

  const admin = createAdminClient();
  const { data: target, error: readErr } = await admin
    .from("app_users")
    .select("id,display_name,email,role")
    .eq("id", input.targetUserId)
    .maybeSingle();
  if (readErr) {
    console.error("display_name read failed", readErr);
    return { ok: false, message: "表示名を更新できませんでした" };
  }
  if (!target) {
    return { ok: false, message: "対象ユーザーが見つかりません" };
  }

  const oldName = String(target.display_name ?? "");
  if (oldName === validated.value) {
    return { ok: true, displayName: validated.value };
  }

  const { error: updErr } = await admin
    .from("app_users")
    .update({
      display_name: validated.value,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.targetUserId);
  if (updErr) {
    console.error("display_name update failed", updErr);
    return { ok: false, message: "表示名を更新できませんでした" };
  }

  // Auth user_metadata も揃える（表示の補助。正は app_users）
  try {
    await admin.auth.admin.updateUserById(input.targetUserId, {
      user_metadata: { display_name: validated.value },
    });
  } catch (e) {
    console.error("auth metadata display_name sync failed", e);
  }

  await admin.from("audit_logs").insert({
    actor_id: input.actor.id,
    actor_name: input.actor.display_name,
    action: "user.display_name_change",
    entity_type: "app_user",
    notion_page_id: null,
    changed_fields: {
      target_user_id: input.targetUserId,
      old_display_name: oldName,
      new_display_name: validated.value,
    },
    operation_source: "app",
    request_id: null,
    batch_id: null,
  });

  return { ok: true, displayName: validated.value };
}
