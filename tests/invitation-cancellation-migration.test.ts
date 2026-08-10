import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260810010000_invitation_cancellation.sql",
  ),
  "utf8",
);

describe("safe invitation cancellation migration", () => {
  it("enforces admin, pending, profile, Auth activation, and business-reference guards", () => {
    expect(migration).toContain("v_actor.role <> 'admin'");
    expect(migration).toContain("v_invitation.status <> 'pending'");
    expect(migration).toContain("from public.app_users");
    expect(migration).toContain("v_auth.email_confirmed_at is not null");
    expect(migration).toContain("v_auth.last_sign_in_at is not null");
    expect(migration).toContain("invitation_user_has_business_references");
    expect(migration).toContain("invitation_state_ambiguous");
  });

  it("locks state, records cancellation and cleanup audits, and is idempotent", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("'already_cancelled'");
    expect(migration).toContain("'user.invite_cancel'");
    expect(migration).toContain("'user.invite_auth_cleanup'");
  });

  it("archives invitation history without deleting app_users or Auth users", () => {
    const archiveFunction = migration.match(
      /create or replace function public\.archive_invitation_history[\s\S]*?end \$\$;/,
    )?.[0];
    expect(archiveFunction).toContain("archived_at = pg_catalog.now()");
    expect(archiveFunction).toContain("'user.invite_history_archive'");
    expect(archiveFunction).not.toContain("delete from");
    expect(archiveFunction).not.toContain("auth.users");
  });

  it("exposes mutation RPCs only to the service role", () => {
    expect(migration).toMatch(
      /revoke execute on function public\.prepare_invitation_cancellation[\s\S]*from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.prepare_invitation_cancellation[\s\S]*to service_role;/,
    );
  });
});
