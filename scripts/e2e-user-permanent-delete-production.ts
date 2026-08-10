import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PRODUCTION_URL = "https://sales-system-weld.vercel.app";
const FIXTURE_PREFIX = "Codex完全削除fixture";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function requireData<T>(
  label: string,
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function createInviteFixture(input: {
  admin: SupabaseClient;
  actorId: string;
  email: string;
  displayName: string;
}) {
  const invitation = await requireData(
    "insert invitation fixture",
    input.admin
      .from("user_invitations")
      .insert({
        email: input.email,
        normalized_email: input.email,
        display_name: input.displayName,
        role: "viewer",
        invited_by: input.actorId,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single(),
  );

  const generated = await input.admin.auth.admin.generateLink({
    type: "invite",
    email: input.email,
    options: {
      redirectTo: `${PRODUCTION_URL}/auth/invite`,
      data: {
        display_name: input.displayName,
        invitation_id: invitation.id,
        invitation_source: "sales_system",
        fixture: true,
      },
    },
  });
  if (generated.error || !generated.data.user) {
    throw new Error(`generate invite fixture: ${generated.error?.message ?? "no user"}`);
  }
  const actionLink = generated.data.properties.action_link;
  assert(!actionLink.includes("localhost"), "fixture invite URL contains localhost");
  assert(
    decodeURIComponent(actionLink).includes(`${PRODUCTION_URL}/auth/invite`),
    "fixture invite URL does not use the Production invite route",
  );

  await requireData(
    "link invitation Auth id",
    input.admin
      .from("user_invitations")
      .update({ auth_user_id: generated.data.user.id })
      .eq("id", invitation.id)
      .select("id")
      .single(),
  );
  return { invitationId: String(invitation.id), userId: generated.data.user.id };
}

async function hardDeleteAcceptedFixture(input: {
  admin: SupabaseClient;
  actorId: string;
  targetUserId: string;
}) {
  const prepared = await requireData<Record<string, unknown>>(
    "prepare accepted fixture deletion",
    input.admin.rpc("prepare_user_permanent_deletion", {
      p_actor_id: input.actorId,
      p_target_user_id: input.targetUserId,
      p_reason: "test",
    }),
  );
  assert(prepared.state === "ready_for_auth_cleanup", "accepted fixture was not prepared");
  assert(prepared.auth_user_id === input.targetUserId, "prepared Auth id mismatch");

  const authUser = await input.admin.auth.admin.getUserById(input.targetUserId);
  assert(!authUser.error && authUser.data.user, "accepted fixture Auth user is missing");
  assert(
    authUser.data.user.email === prepared.normalized_email &&
      authUser.data.user.user_metadata?.invitation_id === prepared.invitation_id,
    "accepted fixture Auth identity mismatch",
  );
  const deleted = await input.admin.auth.admin.deleteUser(input.targetUserId, false);
  if (deleted.error) throw new Error(`delete accepted fixture Auth: ${deleted.error.message}`);

  await requireData(
    "finalize accepted fixture deletion",
    input.admin.rpc("finalize_user_permanent_deletion", {
      p_actor_id: input.actorId,
      p_target_user_id: input.targetUserId,
      p_auth_outcome: "deleted",
    }),
  );
}

async function archiveInvitation(
  admin: SupabaseClient,
  actorId: string,
  invitationId: string,
) {
  const archived = await admin.rpc("archive_invitation_history", {
    p_actor_id: actorId,
    p_invitation_id: invitationId,
  });
  if (archived.error) throw new Error(`archive fixture invitation: ${archived.error.message}`);
}

async function main() {
  assert(
    requireEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "") === PRODUCTION_URL,
    "refusing to run: NEXT_PUBLIC_APP_URL is not the canonical Production URL",
  );
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = requireEnv("SUPABASE_SECRET_KEY");
  const publishableKey = requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const publicClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const actors = await requireData(
    "read active admin",
    admin
      .from("app_users")
      .select("id")
      .eq("role", "admin")
      .eq("is_active", true)
      .limit(1),
  );
  const actorId = actors[0]?.id;
  assert(actorId, "no active admin is available for fixture audit attribution");

  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const emailA = `codex-permanent-a-${runId}@example.invalid`;
  const emailB = `codex-permanent-b-${runId}@example.invalid`;
  const displayA = `${FIXTURE_PREFIX}A`;
  const displayB = `${FIXTURE_PREFIX}B`;
  const password = `Fixture-${randomUUID()}-9a`;
  let inviteA: { invitationId: string; userId: string } | null = null;
  let inviteB: { invitationId: string; userId: string } | null = null;
  let directUserId: string | null = null;
  let directRequestId: string | null = null;
  let actionFixtureId: string | null = null;
  let completed = false;

  try {
    // A: pending invitation -> cancellation + Auth hard delete.
    inviteA = await createInviteFixture({
      admin,
      actorId,
      email: emailA,
      displayName: displayA,
    });
    const cancellation = await requireData<Record<string, unknown>>(
      "prepare pending cancellation",
      admin.rpc("prepare_invitation_cancellation", {
        p_actor_id: actorId,
        p_invitation_id: inviteA.invitationId,
      }),
    );
    assert(cancellation.state === "ready_for_auth_cleanup", "pending fixture was not cancellable");
    assert(cancellation.auth_user_id === inviteA.userId, "pending fixture Auth id mismatch");
    const pendingDeleted = await admin.auth.admin.deleteUser(inviteA.userId, false);
    if (pendingDeleted.error) throw new Error(`delete pending fixture Auth: ${pendingDeleted.error.message}`);
    await requireData(
      "record pending Auth cleanup",
      admin.rpc("record_invitation_auth_cleanup", {
        p_actor_id: actorId,
        p_invitation_id: inviteA.invitationId,
        p_cleanup_status: "deleted",
        p_detail: null,
      }),
    );
    const pendingAuthAfter = await admin.auth.admin.getUserById(inviteA.userId);
    assert(pendingAuthAfter.error || !pendingAuthAfter.data.user, "pending Auth fixture still exists");
    const pendingProfileAfter = await requireData(
      "check pending profile absence",
      admin.from("app_users").select("id").eq("id", inviteA.userId),
    );
    assert(pendingProfileAfter.length === 0, "pending fixture unexpectedly has app_users");

    // Re-register the exact same email through the direct-create DB/Auth workflow.
    directRequestId = randomUUID();
    const begun = await requireData(
      "begin same-email direct create",
      admin.rpc("begin_direct_user_provisioning", {
        p_actor_id: actorId,
        p_request_id: directRequestId,
        p_email: emailA,
      }),
    );
    assert(begun === "started", "same-email direct create did not start");
    const authCreated = await admin.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayA, fixture: true },
    });
    if (authCreated.error || !authCreated.data.user) {
      throw new Error(`same-email Auth create: ${authCreated.error?.message ?? "no user"}`);
    }
    directUserId = authCreated.data.user.id;
    assert(directUserId !== inviteA.userId, "same-email direct create reused the old Auth UUID");
    await requireData(
      "complete same-email direct create",
      admin.rpc("complete_direct_user_provisioning", {
        p_actor_id: actorId,
        p_request_id: directRequestId,
        p_user_id: directUserId,
        p_email: emailA,
        p_display_name: displayA,
        p_role: "viewer",
      }),
    );
    const signedIn = await publicClient.auth.signInWithPassword({ email: emailA, password });
    if (signedIn.error || !signedIn.data.user) {
      throw new Error(`same-email login: ${signedIn.error?.message ?? "no user"}`);
    }
    assert(signedIn.data.user.id === directUserId, "same-email login returned the wrong Auth UUID");
    await publicClient.auth.signOut();

    // B: accepted fixture with one business reference -> hard delete denied.
    inviteB = await createInviteFixture({
      admin,
      actorId,
      email: emailB,
      displayName: displayB,
    });
    const acceptedAuth = await admin.auth.admin.updateUserById(inviteB.userId, {
      password,
      email_confirm: true,
    });
    if (acceptedAuth.error) throw new Error(`confirm accepted fixture: ${acceptedAuth.error.message}`);
    await requireData(
      "accept fixture invitation",
      admin.rpc("accept_invitation_and_provision", {
        p_user_id: inviteB.userId,
        p_email: emailB,
      }),
    );
    actionFixtureId = `fixture-action-${runId}`;
    await requireData(
      "insert fixture business reference",
      admin.from("action_index").insert({
        notion_page_id: actionFixtureId,
        title: `${FIXTURE_PREFIX} action`,
        customer_page_id: `fixture-customer-${runId}`,
        assignee_user_id: inviteB.userId,
        created_by: inviteB.userId,
      }),
    );
    const rejected = await admin.rpc("prepare_user_permanent_deletion", {
      p_actor_id: actorId,
      p_target_user_id: inviteB.userId,
      p_reason: "test",
    });
    assert(rejected.error?.message.includes("business_references"), "business reference did not reject hard delete");
    const authDisabled = await admin.auth.admin.updateUserById(inviteB.userId, {
      ban_duration: "876000h",
    });
    if (authDisabled.error) throw new Error(`disable fixture Auth: ${authDisabled.error.message}`);
    await requireData(
      "disable fixture profile",
      admin.rpc("set_app_user_active", {
        p_actor_id: actorId,
        p_target_user_id: inviteB.userId,
        p_active: false,
      }),
    );
    const disabledProfile = await requireData(
      "verify fixture disabled",
      admin.from("app_users").select("is_active").eq("id", inviteB.userId).single(),
    );
    assert(disabledProfile.is_active === false, "business-reference fixture was not disabled");

    // Remove only the exact fixture reference, re-enable, and use the feature for cleanup.
    await requireData(
      "remove fixture business reference",
      admin.from("action_index").delete().eq("notion_page_id", actionFixtureId),
    );
    actionFixtureId = null;
    const authEnabled = await admin.auth.admin.updateUserById(inviteB.userId, {
      ban_duration: "none",
    });
    if (authEnabled.error) throw new Error(`re-enable fixture Auth: ${authEnabled.error.message}`);
    await requireData(
      "re-enable fixture profile",
      admin.rpc("set_app_user_active", {
        p_actor_id: actorId,
        p_target_user_id: inviteB.userId,
        p_active: true,
      }),
    );
    await hardDeleteAcceptedFixture({ admin, actorId, targetUserId: inviteB.userId });
    const deletedProfile = await requireData(
      "verify accepted profile absence",
      admin.from("app_users").select("id").eq("id", inviteB.userId),
    );
    assert(deletedProfile.length === 0, "accepted fixture app_users still exists");
    const deletedAuth = await admin.auth.admin.getUserById(inviteB.userId);
    assert(deletedAuth.error || !deletedAuth.data.user, "accepted fixture Auth still exists");
    const retainedAudit = await requireData(
      "verify permanent-delete audit",
      admin
        .from("audit_logs")
        .select("id")
        .eq("action", "user.permanent_delete")
        .contains("changed_fields", { target_user_id: inviteB.userId })
        .limit(1),
    );
    assert(retainedAudit.length === 1, "permanent-delete audit did not survive");

    completed = true;
    console.log(
      JSON.stringify({
        pendingInviteAuthRemoved: true,
        pendingInviteProfileAbsent: true,
        sameEmailDirectCreate: true,
        sameEmailLogin: true,
        newAuthUserIdDiffers: true,
        businessReferenceRejected: true,
        softDisableSucceeded: true,
        acceptedNoReferenceDeleted: true,
        auditSurvived: true,
      }),
    );
  } finally {
    if (actionFixtureId) {
      await admin.from("action_index").delete().eq("notion_page_id", actionFixtureId);
    }
    if (inviteB) {
      const profile = await admin
        .from("app_users")
        .select("id,email,display_name,notion_staff_page_id")
        .eq("id", inviteB.userId)
        .maybeSingle();
      if (
        profile.data?.email === emailB &&
        profile.data.display_name === displayB &&
        !profile.data.notion_staff_page_id
      ) {
        const counts = await admin.rpc("user_permanent_delete_reference_counts", {
          p_user_id: inviteB.userId,
        });
        const total = Object.values(counts.data ?? {}).reduce(
          (sum, value) => sum + Number(value ?? 0),
          0,
        );
        if (total === 0) {
          await admin.auth.admin.updateUserById(inviteB.userId, { ban_duration: "none" });
          if (profile.data) {
            await admin.rpc("set_app_user_active", {
              p_actor_id: actorId,
              p_target_user_id: inviteB.userId,
              p_active: true,
            });
          }
          try {
            await hardDeleteAcceptedFixture({ admin, actorId, targetUserId: inviteB.userId });
          } catch {
            // Refuse broad fallback deletion; the fixture stays visible for manual review.
          }
        }
      } else if (!profile.data) {
        const auth = await admin.auth.admin.getUserById(inviteB.userId);
        if (
          auth.data.user?.email === emailB &&
          auth.data.user.user_metadata?.fixture === true
        ) {
          await admin.auth.admin.deleteUser(inviteB.userId, false);
        }
      }
    }
    if (directUserId && directRequestId) {
      const directProfile = await admin
        .from("app_users")
        .select("id,email,display_name,notion_staff_page_id")
        .eq("id", directUserId)
        .maybeSingle();
      if (
        directProfile.data?.email === emailA &&
        directProfile.data.display_name === displayA &&
        !directProfile.data.notion_staff_page_id
      ) {
        await admin.from("jobs").delete().eq("idempotency_key", `user_provisioning:${directUserId}`);
        await admin
          .from("user_admin_operations")
          .delete()
          .eq("request_id", directRequestId)
          .eq("target_user_id", directUserId)
          .eq("normalized_email", emailA);
        const counts = await admin.rpc("user_permanent_delete_reference_counts", {
          p_user_id: directUserId,
        });
        const total = Object.values(counts.data ?? {}).reduce(
          (sum, value) => sum + Number(value ?? 0),
          0,
        );
        if (total === 0) {
          await admin.from("app_users").delete().eq("id", directUserId).eq("email", emailA);
          const auth = await admin.auth.admin.getUserById(directUserId);
          if (
            auth.data.user?.email === emailA &&
            auth.data.user.user_metadata?.fixture === true
          ) {
            await admin.auth.admin.deleteUser(directUserId, false);
          }
        } else {
          await admin.auth.admin.updateUserById(directUserId, { ban_duration: "876000h" });
          await admin.rpc("set_app_user_active", {
            p_actor_id: actorId,
            p_target_user_id: directUserId,
            p_active: false,
          });
        }
      }
    }
    if (inviteA) await archiveInvitation(admin, actorId, inviteA.invitationId);
    if (inviteB) await archiveInvitation(admin, actorId, inviteB.invitationId);
    if (!completed) console.error("fixture E2E stopped; only exact safe cleanup was attempted");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
