import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260810020000_user_permanent_deletion.sql",
  ),
  "utf8",
);

describe("permanent user deletion migration", () => {
  it("guards self, last admin, invitation identity, Auth identity, and Storage ownership", () => {
    expect(migration).toContain("'self_delete'");
    expect(migration).toContain("'last_admin'");
    expect(migration).toContain("'invitation_identity_mismatch'");
    expect(migration).toContain("'auth_identity_mismatch'");
    expect(migration).toContain("'storage_owned'");
    expect(migration).toContain("raw_user_meta_data #>> '{invitation_id}'");
  });

  it.each([
    ["call attempt", "prospect_call_attempts where performed_by = p_user_id"],
    ["activity author/editor", "activity_index where created_by = p_user_id or updated_by = p_user_id"],
    ["deal staff", "deal_index where p_user_id = any(staff_user_ids)"],
    ["inquiry assignment", "inquiries where assigned_user_id = p_user_id"],
    ["prospect assignment", "prospect_list_memberships where assigned_user_id = p_user_id or claimed_by = p_user_id"],
    ["action assignment", "action_index where assignee_user_id = p_user_id or created_by = p_user_id"],
    ["storage ownership", "from storage.objects object_row"],
  ])("rejects %s references through a counted source", (_label, expression) => {
    expect(migration).toContain(expression);
  });

  it("counts every reviewed user relation and fails closed on future app_users foreign keys", () => {
    for (const source of [
      "customer_index",
      "contract_index",
      "complaint_index",
      "write_operations",
      "jobs",
      "import_jobs",
      "saved_searches",
      "recent_views",
      "system_settings",
      "gmail_oauth_states",
      "inquiry_draft_requests",
      "prospect_lists",
      "prospects",
      "prospect_import_jobs",
      "user_admin_operations",
      "user_invitations",
    ]) {
      expect(migration).toContain(`public.${source}`);
    }
    expect(migration).toContain("unreviewed_app_user_foreign_keys");
    expect(migration).toContain("constraint_row.confrelid = 'public.app_users'");
  });

  it("locks references, verifies zero, deletes only app_users, and retains invitation history", () => {
    expect(migration).toContain("in share row exclusive mode");
    expect(migration).toContain("delete from public.app_users");
    expect(migration).not.toContain("delete from public.user_invitations");
    expect(migration).not.toContain("delete from public.audit_logs");
    expect(migration).toContain("set status = 'revoked'");
    expect(migration).toContain("'user.permanent_delete'");
    expect(migration).toContain("'reference_counts', v_counts");
  });

  it("has durable compensation and idempotent completion states", () => {
    expect(migration).toContain("user_permanent_deletion_operations");
    expect(migration).toContain("restore_user_after_permanent_delete_failure");
    expect(migration).toContain("'already_deleted'");
    expect(migration).toContain("'already_completed'");
    expect(migration).toContain("'profile_deleted'");
  });

  it("exposes destructive RPCs only to service_role", () => {
    expect(migration).toMatch(
      /revoke execute on function public\.prepare_user_permanent_deletion[\s\S]*from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.prepare_user_permanent_deletion[\s\S]*to service_role;/,
    );
  });
});
