import { createHash, randomUUID } from "node:crypto";

/**
 * Destructive Production fixture E2E. This file is intentionally not wired to a
 * normal test command and must never be run without all guards below.
 *
 * PowerShell invocation (only after the matching migrations are deployed):
 *   $env:NODE_OPTIONS='--require ./scripts/shims/mock-server-only.cjs'
 *   $env:NEXT_PUBLIC_APP_URL='https://sales-system-weld.vercel.app'
 *   $env:CONFIRM_PRODUCTION_PROSPECT_TRANSACTION_E2E='WRITE_EXACT_PRODUCTION_FIXTURES'
 *   npx tsx --env-file=.env.local scripts/e2e-prospect-transaction-boundaries.ts
 *
 * The script never calls /api/jobs/run and never writes to Notion. All writes
 * use generated fixture UUIDs. Append-only audit rows are deliberately retained.
 */

import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  createProductionFixtureDirectAuthUser,
  deleteProductionFixtureAuthUser,
} from "@/lib/auth/admin-api";
import type { Database } from "@/types/database";

const CANONICAL_PRODUCTION_URL = "https://sales-system-weld.vercel.app";
const EXPECTED_SUPABASE_PROJECT_REF = "tutweacvoyvlzjbjfogq";
const CONFIRM_ENV = "CONFIRM_PRODUCTION_PROSPECT_TRANSACTION_E2E";
const CONFIRM_VALUE = "WRITE_EXACT_PRODUCTION_FIXTURES";
const FIXTURE_PREFIX = "Codex完全削除fixture ProspectTx";

type Client = SupabaseClient<Database>;
type JsonObject = Record<string, unknown>;
type QueryResult<T> = {
  data: T | null;
  error: PostgrestError | null;
};
type LooseRpc = (
  functionName: string,
  args?: JsonObject,
) => PromiseLike<QueryResult<unknown>>;

type FixtureUser = {
  id: string;
  email: string;
  password: string;
  displayName: string;
};

type CallFixture = {
  listId: string;
  prospectId: string;
  membershipId: string;
};

type NormalizedImportRow = {
  rowId: string;
  rowNumber: number;
  core: JsonObject;
  contact: JsonObject;
  sourceRowHash: string;
  sourceAttributes: JsonObject;
  externalRecordId: string;
  notes: string | null;
  formalMatch: JsonObject;
};

type CheckName =
  | "guards"
  | "fixture_identity"
  | "call_same_request_exactly_once"
  | "call_different_requests_single_commit"
  | "call_rejections_zero_write"
  | "call_state_kpi_audit_release"
  | "rpc_acl_service_only"
  | "import_legacy_enqueue_rejected"
  | "csv_start_archive_atomic"
  | "import_duplicate_chunk_exactly_once"
  | "import_source_hash_reuse_counters"
  | "import_cross_list_dedupe_serialized"
  | "import_terminal_queue_reconciled"
  | "after_archive_zero_business_writes"
  | "preexisting_imports_preserved"
  | "audit_append_only_retained"
  | "cleanup_exact"
  | "cleanup_verified"
  | "ok";

type Checks = Record<CheckName, boolean>;

type State = {
  runId: string;
  marker: string;
  user: FixtureUser | null;
  listIds: Set<string>;
  prospectIds: Set<string>;
  membershipIds: Set<string>;
  contactIds: Set<string>;
  importJobIds: Set<string>;
  importRowIds: Set<string>;
  queueJobIds: Set<string>;
  callAttemptIds: Set<string>;
  callRequestIds: Set<string>;
  auditRows: Map<string, { actorId: string; action: string }>;
  preexistingImportIds: Set<string>;
};

const checks: Checks = {
  guards: false,
  fixture_identity: false,
  call_same_request_exactly_once: false,
  call_different_requests_single_commit: false,
  call_rejections_zero_write: false,
  call_state_kpi_audit_release: false,
  rpc_acl_service_only: false,
  import_legacy_enqueue_rejected: false,
  csv_start_archive_atomic: false,
  import_duplicate_chunk_exactly_once: false,
  import_source_hash_reuse_counters: false,
  import_cross_list_dedupe_serialized: false,
  import_terminal_queue_reconciled: false,
  after_archive_zero_business_writes: false,
  preexisting_imports_preserved: false,
  audit_append_only_retained: false,
  cleanup_exact: false,
  cleanup_verified: false,
  ok: false,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function asObject(value: unknown, label: string): JsonObject {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), label);
  return value as JsonObject;
}

function asString(value: unknown, label: string): string {
  assert(typeof value === "string" && value.length > 0, label);
  return value;
}

function asNumber(value: unknown, label: string): number {
  const number = Number(value);
  assert(Number.isFinite(number), label);
  return number;
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

async function requireData<T>(
  label: string,
  promise: PromiseLike<QueryResult<T>>,
): Promise<T> {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  assert(result.data !== null, `${label}: no data`);
  return result.data;
}

async function rpc<T>(
  client: Client,
  functionName: string,
  args: JsonObject,
): Promise<QueryResult<T>> {
  const invoke = client.rpc.bind(client) as unknown as LooseRpc;
  return (await invoke(functionName, args)) as QueryResult<T>;
}

async function requireRpc<T>(
  label: string,
  client: Client,
  functionName: string,
  args: JsonObject,
): Promise<T> {
  return requireData(label, rpc<T>(client, functionName, args));
}

function assertRpcMessage(error: PostgrestError | null, expected: string): void {
  assert(error, `expected RPC error ${expected}`);
  assert(error.message.includes(expected), `unexpected RPC error for ${expected}`);
}

function isAclRejection(error: PostgrestError | null): boolean {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return (
    error.code === "42501" ||
    error.code === "PGRST202" ||
    message.includes("permission denied") ||
    message.includes("not find the function")
  );
}

function makeClient(url: string, key: string): Client {
  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function validateProductionGuards(): {
  supabaseUrl: string;
  secretKey: string;
  publishableKey: string;
} {
  const appUrl = new URL(requireEnv("NEXT_PUBLIC_APP_URL"));
  assert(
    appUrl.origin === CANONICAL_PRODUCTION_URL &&
      appUrl.pathname.replace(/\/$/, "") === "" &&
      !appUrl.search &&
      !appUrl.hash,
    "NEXT_PUBLIC_APP_URL is not the canonical Production URL",
  );

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const parsedSupabaseUrl = new URL(supabaseUrl);
  assert(parsedSupabaseUrl.protocol === "https:", "Supabase URL must use HTTPS");
  assert(
    parsedSupabaseUrl.hostname === `${EXPECTED_SUPABASE_PROJECT_REF}.supabase.co`,
    "Supabase project ref does not match Production",
  );
  assert(
    parsedSupabaseUrl.pathname === "/" &&
      !parsedSupabaseUrl.username &&
      !parsedSupabaseUrl.password &&
      !parsedSupabaseUrl.search &&
      !parsedSupabaseUrl.hash,
    "Supabase URL must be the canonical project origin",
  );

  const secretKey = requireEnv("SUPABASE_SECRET_KEY");
  const publishableKey = requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  assert(secretKey !== publishableKey, "service and publishable keys must differ");
  assert(requireEnv(CONFIRM_ENV) === CONFIRM_VALUE, "explicit Production confirmation is missing");

  return { supabaseUrl, secretKey, publishableKey };
}

function makeState(): State {
  const runId = `${Date.now()}-${randomUUID()}`;
  return {
    runId,
    marker: `${FIXTURE_PREFIX} ${runId}`,
    user: null,
    listIds: new Set(),
    prospectIds: new Set(),
    membershipIds: new Set(),
    contactIds: new Set(),
    importJobIds: new Set(),
    importRowIds: new Set(),
    queueJobIds: new Set(),
    callAttemptIds: new Set(),
    callRequestIds: new Set(),
    auditRows: new Map(),
    preexistingImportIds: new Set(),
  };
}

async function listAllIds(client: Client, table: "prospect_import_jobs"): Promise<Set<string>> {
  const ids = new Set<string>();
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const rows = await requireData<JsonObject[]>(
      `list ${table}`,
      client.from(table).select("id").order("id").range(from, from + pageSize - 1),
    );
    for (const row of rows) ids.add(asString(row.id, `${table}.id`));
    if (rows.length < pageSize) break;
  }
  return ids;
}

async function findExactFixtureAuthUser(input: {
  admin: Client;
  email: string;
  displayName: string;
}): Promise<string | null> {
  const perPage = 500;
  for (let page = 1; ; page += 1) {
    const listed = await input.admin.auth.admin.listUsers({ page, perPage });
    if (listed.error) throw new Error("fixture Auth reconciliation failed");
    const matches = listed.data.users.filter(
      (candidate) =>
        candidate.email?.toLowerCase() === input.email &&
        candidate.user_metadata?.fixture === true &&
        candidate.user_metadata?.display_name === input.displayName,
    );
    assert(matches.length <= 1, "multiple exact fixture Auth identities exist");
    if (matches.length === 1) return matches[0].id;
    if (listed.data.users.length < perPage) return null;
  }
}

async function createFixtureUser(admin: Client, state: State): Promise<FixtureUser> {
  const email = `codex-prospect-tx-${state.runId}@example.invalid`.toLowerCase();
  const displayName = `${state.marker} actor`;
  const password = `Fixture-${randomUUID()}-Aa9!`;
  assert(email.endsWith("@example.invalid"), "fixture email suffix mismatch");
  assert(displayName.startsWith(FIXTURE_PREFIX), "fixture display prefix mismatch");

  const created = await createProductionFixtureDirectAuthUser({
    email,
    password,
    displayName,
  });
  if (!created.ok) {
    if (created.code === "auth_error") {
      const recoveredId = await findExactFixtureAuthUser({ admin, email, displayName });
      if (recoveredId) {
        state.user = { id: recoveredId, email, password, displayName };
      }
    }
    throw new Error(`fixture Auth creation failed: ${created.code}`);
  }
  const user: FixtureUser = { id: created.userId, email, password, displayName };
  state.user = user;

  const authIdentity = await admin.auth.admin.getUserById(user.id);
  assert(!authIdentity.error && authIdentity.data.user, "fixture Auth identity is missing");
  assert(authIdentity.data.user.id === user.id, "fixture Auth UUID mismatch");
  assert(authIdentity.data.user.email?.toLowerCase() === email, "fixture Auth email mismatch");
  assert(authIdentity.data.user.user_metadata?.fixture === true, "fixture Auth metadata mismatch");
  assert(
    authIdentity.data.user.user_metadata?.display_name === displayName,
    "fixture Auth display name mismatch",
  );

  const profile = await requireData<JsonObject>(
    "insert fixture app user",
    admin
      .from("app_users")
      .insert({
        id: user.id,
        email: user.email,
        display_name: user.displayName,
        role: "b",
        is_active: true,
        provisioning_status: "completed",
      })
      .select("id,email,display_name,role,is_active,provisioning_status")
      .single(),
  );
  assert(profile.id === user.id, "fixture profile UUID mismatch");
  assert(profile.email === user.email, "fixture profile email mismatch");
  assert(profile.display_name === user.displayName, "fixture profile name mismatch");
  assert(profile.role === "b", "fixture profile must be role B");
  assert(profile.is_active === true, "fixture profile must be active");
  assert(profile.provisioning_status === "completed", "fixture profile is not provisioned");
  return user;
}

async function createCallFixture(
  admin: Client,
  state: State,
  user: FixtureUser,
  label: string,
  options: { claimed?: boolean; archivedList?: boolean } = {},
): Promise<CallFixture> {
  const listId = randomUUID();
  const prospectId = randomUUID();
  const membershipId = randomUUID();
  state.listIds.add(listId);
  state.prospectIds.add(prospectId);
  state.membershipIds.add(membershipId);

  const listName = `${state.marker} call ${label}`;
  await requireData(
    `insert call list ${label}`,
    admin
      .from("prospect_lists")
      .insert({
        id: listId,
        name: listName,
        description: state.marker,
        status: options.archivedList ? "archived" : "active",
        source_type: "manual",
        source_name: state.marker,
        owner_user_id: user.id,
        created_by: user.id,
        archived_at: options.archivedList ? new Date().toISOString() : null,
      })
      .select("id")
      .single(),
  );
  await requireData(
    `insert call prospect ${label}`,
    admin
      .from("prospects")
      .insert({
        id: prospectId,
        company_name: `${state.marker} call company ${label}`,
        normalized_company_name: `${state.runId}-${label}`.toLowerCase(),
        search_text: `${state.marker} ${label}`,
        created_by: user.id,
      })
      .select("id")
      .single(),
  );
  await requireData(
    `insert call membership ${label}`,
    admin
      .from("prospect_list_memberships")
      .insert({
        id: membershipId,
        prospect_list_id: listId,
        prospect_id: prospectId,
        assigned_user_id: user.id,
        stage: "new",
        source_record_id: `${state.runId}:${label}`,
        source_row_hash: sha256(`${state.runId}:${label}`),
        source_attributes: { fixture: state.runId },
        claimed_by: options.claimed ? user.id : null,
        claimed_at: options.claimed ? new Date().toISOString() : null,
        claim_expires_at: options.claimed
          ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
          : null,
      })
      .select("id")
      .single(),
  );
  return { listId, prospectId, membershipId };
}

function callArgs(input: {
  requestId: string;
  fixture: CallFixture;
  user: FixtureUser;
  result?: string;
  startedAt: string;
  nextContactAt?: string | null;
}): JsonObject {
  return {
    p_request_id: input.requestId,
    p_membership_id: input.fixture.membershipId,
    p_prospect_id: input.fixture.prospectId,
    p_contact_id: null,
    p_performed_by: input.user.id,
    p_result: input.result ?? "connected",
    p_note: null,
    p_started_at: input.startedAt,
    p_next_contact_at: input.nextContactAt ?? null,
    p_clear_next_contact: false,
    p_phone_used: null,
    p_phone_normalized: null,
  };
}

async function readCallSnapshot(
  admin: Client,
  fixture: CallFixture,
  requestIds: string[],
): Promise<JsonObject> {
  const membership = await requireData<JsonObject>(
    "read call membership snapshot",
    admin
      .from("prospect_list_memberships")
      .select("stage,next_contact_at,last_contact_at,last_call_result,call_count,claimed_by,claimed_at,claim_expires_at")
      .eq("id", fixture.membershipId)
      .single(),
  );
  const prospect = await requireData<JsonObject>(
    "read call prospect snapshot",
    admin
      .from("prospects")
      .select("do_not_contact,do_not_contact_reason,do_not_contact_at,phone_invalid")
      .eq("id", fixture.prospectId)
      .single(),
  );
  const attempts = requestIds.length
    ? await requireData<JsonObject[]>(
        "read call attempts snapshot",
        admin.from("prospect_call_attempts").select("id").in("request_id", requestIds),
      )
    : [];
  const audits = requestIds.length
    ? await requireData<JsonObject[]>(
        "read call audit snapshot",
        admin.from("audit_logs").select("id").in("request_id", requestIds),
      )
    : [];
  return {
    membership,
    prospect,
    attemptCount: attempts.length,
    auditCount: audits.length,
  };
}

async function testCallTransactions(input: {
  admin: Client;
  serviceClients: () => Client;
  state: State;
  user: FixtureUser;
}): Promise<void> {
  const { admin, serviceClients, state, user } = input;

  // Production claim_next_prospect_call also expires every stale lease in the
  // table. Seed only the exact fixture lease directly so this E2E never mutates
  // another operator's stale claim; ACL is tested separately with a null actor.

  const same = await createCallFixture(admin, state, user, "same-request", {
    claimed: true,
  });
  const sameRequestId = randomUUID();
  const sameStartedAt = new Date().toISOString();
  state.callRequestIds.add(sameRequestId);
  const sameArgs = callArgs({
    requestId: sameRequestId,
    fixture: same,
    user,
    startedAt: sameStartedAt,
  });
  const sameResults = await Promise.all([
    rpc<JsonObject[]>(serviceClients(), "save_prospect_call_attempt", sameArgs),
    rpc<JsonObject[]>(serviceClients(), "save_prospect_call_attempt", sameArgs),
  ]);
  assert(sameResults.every((result) => !result.error), "same-request RPC failed");
  const sameRows = sameResults.map((result) => {
    assert(result.data, "same-request RPC returned no data");
    assert(result.data.length === 1, "same-request RPC returned unexpected row count");
    return result.data[0];
  });
  const firstSuccesses = sameRows.filter((row) => row.duplicated === false);
  const duplicates = sameRows.filter((row) => row.duplicated === true);
  assert(firstSuccesses.length === 1 && duplicates.length === 1, "same request was not exactly once");
  assert(firstSuccesses[0].attempt_id === duplicates[0].attempt_id, "same request returned different attempts");
  const responseLossRetry = await requireRpc<JsonObject[]>(
    "retry same request after committed response",
    serviceClients(),
    "save_prospect_call_attempt",
    sameArgs,
  );
  assert(responseLossRetry.length === 1, "response-loss retry returned unexpected row count");
  assert(responseLossRetry[0].duplicated === true, "response-loss retry was not idempotent");
  assert(
    responseLossRetry[0].attempt_id === firstSuccesses[0].attempt_id,
    "response-loss retry returned a different attempt",
  );

  const sameAttempts = await requireData<JsonObject[]>(
    "verify same-request attempt",
    admin
      .from("prospect_call_attempts")
      .select("id,request_id,input_snapshot,result_snapshot,performed_by")
      .eq("request_id", sameRequestId),
  );
  assert(sameAttempts.length === 1, "same request created more than one attempt");
  assert(sameAttempts[0].performed_by === user.id, "same-request actor mismatch");
  assert(sameAttempts[0].input_snapshot, "same-request input snapshot missing");
  assert(sameAttempts[0].result_snapshot, "same-request result snapshot missing");
  state.callAttemptIds.add(asString(sameAttempts[0].id, "same attempt id"));
  checks.call_same_request_exactly_once = true;

  const sameMembership = await requireData<JsonObject>(
    "verify same-request membership",
    admin
      .from("prospect_list_memberships")
      .select("stage,call_count,last_call_result,claimed_by,claimed_at,claim_expires_at")
      .eq("id", same.membershipId)
      .single(),
  );
  assert(sameMembership.stage === "working", "call stage was not updated");
  assert(asNumber(sameMembership.call_count, "call count") === 1, "call count was not incremented once");
  assert(sameMembership.last_call_result === "connected", "last call result mismatch");
  assert(
    sameMembership.claimed_by === null &&
      sameMembership.claimed_at === null &&
      sameMembership.claim_expires_at === null,
    "successful call did not release the claim",
  );
  const sameAudit = await requireData<JsonObject[]>(
    "verify same-request audit",
    admin
      .from("audit_logs")
      .select("id,action,actor_id,request_id")
      .eq("request_id", sameRequestId)
      .eq("action", "prospect.call_attempt.create"),
  );
  assert(sameAudit.length === 1, "same request created an unexpected audit count");
  const kpiRows = await requireRpc<JsonObject[]>(
    "read fixture call KPI",
    admin,
    "prospect_list_call_stats",
    { p_list_ids: [same.listId], p_from: null, p_to: null },
  );
  assert(kpiRows.length === 1, "fixture KPI row missing");
  assert(asNumber(kpiRows[0].attempt_count, "KPI attempt count") === 1, "KPI attempt count mismatch");
  assert(
    asNumber(kpiRows[0].attempted_prospect_count, "KPI prospect count") === 1,
    "KPI prospect count mismatch",
  );
  assert(
    asNumber(kpiRows[0].connected_prospect_count, "KPI connected count") === 1,
    "KPI connected count mismatch",
  );

  const different = await createCallFixture(admin, state, user, "different-request", {
    claimed: true,
  });
  const differentRequestIds = [randomUUID(), randomUUID()];
  differentRequestIds.forEach((id) => state.callRequestIds.add(id));
  const differentStartedAt = new Date().toISOString();
  const differentResults = await Promise.all(
    differentRequestIds.map((requestId) =>
      rpc<JsonObject[]>(
        serviceClients(),
        "save_prospect_call_attempt",
        callArgs({
          requestId,
          fixture: different,
          user,
          startedAt: differentStartedAt,
        }),
      ),
    ),
  );
  const differentSuccesses = differentResults.filter((result) => !result.error);
  const differentFailures = differentResults.filter((result) => result.error);
  assert(
    differentSuccesses.length === 1 && differentFailures.length === 1,
    "different requests did not serialize to one success",
  );
  assertRpcMessage(differentFailures[0].error, "call_claim_required");
  const differentAttempts = await requireData<JsonObject[]>(
    "verify different-request attempts",
    admin
      .from("prospect_call_attempts")
      .select("id,request_id")
      .in("request_id", differentRequestIds),
  );
  assert(differentAttempts.length === 1, "different requests created multiple attempts");
  state.callAttemptIds.add(asString(differentAttempts[0].id, "different attempt id"));
  const differentMembership = await requireData<JsonObject>(
    "verify different-request membership",
    admin
      .from("prospect_list_memberships")
      .select("call_count,claimed_by,claimed_at,claim_expires_at")
      .eq("id", different.membershipId)
      .single(),
  );
  assert(asNumber(differentMembership.call_count, "different call count") === 1, "different call count mismatch");
  assert(
    differentMembership.claimed_by === null &&
      differentMembership.claimed_at === null &&
      differentMembership.claim_expires_at === null,
    "different-request success did not release claim",
  );
  const differentAudits = await requireData<JsonObject[]>(
    "verify different-request audits",
    admin
      .from("audit_logs")
      .select("id")
      .in("request_id", differentRequestIds)
      .eq("action", "prospect.call_attempt.create"),
  );
  assert(differentAudits.length === 1, "different requests created multiple audits");
  checks.call_different_requests_single_commit = true;

  const callback = await createCallFixture(admin, state, user, "callback-rejection", {
    claimed: true,
  });
  const callbackRequest = randomUUID();
  state.callRequestIds.add(callbackRequest);
  const callbackBefore = await readCallSnapshot(admin, callback, [callbackRequest]);
  const callbackResult = await rpc<JsonObject[]>(
    serviceClients(),
    "save_prospect_call_attempt",
    callArgs({
      requestId: callbackRequest,
      fixture: callback,
      user,
      result: "callback_requested",
      startedAt: new Date().toISOString(),
      nextContactAt: null,
    }),
  );
  assertRpcMessage(callbackResult.error, "next_contact_required");
  const callbackAfter = await readCallSnapshot(admin, callback, [callbackRequest]);
  assert(JSON.stringify(callbackBefore) === JSON.stringify(callbackAfter), "callback rejection wrote data");
  const released = await requireRpc<boolean>(
    "release callback fixture claim",
    admin,
    "release_prospect_call_claim",
    { p_membership_id: callback.membershipId, p_user_id: user.id },
  );
  assert(released === true, "exact fixture claim release failed");
  const releasedMembership = await requireData<JsonObject>(
    "verify explicit claim release",
    admin
      .from("prospect_list_memberships")
      .select("claimed_by,claimed_at,claim_expires_at")
      .eq("id", callback.membershipId)
      .single(),
  );
  assert(
    releasedMembership.claimed_by === null &&
      releasedMembership.claimed_at === null &&
      releasedMembership.claim_expires_at === null,
    "explicit claim release left lease fields",
  );

  const noClaim = await createCallFixture(admin, state, user, "claim-rejection");
  const noClaimRequest = randomUUID();
  state.callRequestIds.add(noClaimRequest);
  const noClaimBefore = await readCallSnapshot(admin, noClaim, [noClaimRequest]);
  const noClaimResult = await rpc<JsonObject[]>(
    serviceClients(),
    "save_prospect_call_attempt",
    callArgs({
      requestId: noClaimRequest,
      fixture: noClaim,
      user,
      startedAt: new Date().toISOString(),
    }),
  );
  assertRpcMessage(noClaimResult.error, "call_claim_required");
  const noClaimAfter = await readCallSnapshot(admin, noClaim, [noClaimRequest]);
  assert(JSON.stringify(noClaimBefore) === JSON.stringify(noClaimAfter), "claim rejection wrote data");

  const expiredClaim = await createCallFixture(admin, state, user, "expired-claim-rejection", {
    claimed: true,
  });
  await requireData(
    "expire exact fixture claim",
    admin
      .from("prospect_list_memberships")
      .update({ claim_expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", expiredClaim.membershipId)
      .eq("claimed_by", user.id)
      .select("id")
      .single(),
  );
  const expiredClaimRequest = randomUUID();
  state.callRequestIds.add(expiredClaimRequest);
  const expiredClaimBefore = await readCallSnapshot(admin, expiredClaim, [expiredClaimRequest]);
  const expiredClaimResult = await rpc<JsonObject[]>(
    serviceClients(),
    "save_prospect_call_attempt",
    callArgs({
      requestId: expiredClaimRequest,
      fixture: expiredClaim,
      user,
      startedAt: new Date().toISOString(),
    }),
  );
  assertRpcMessage(expiredClaimResult.error, "call_claim_required");
  const expiredClaimAfter = await readCallSnapshot(admin, expiredClaim, [expiredClaimRequest]);
  assert(
    JSON.stringify(expiredClaimBefore) === JSON.stringify(expiredClaimAfter),
    "expired-claim rejection wrote data",
  );

  const archived = await createCallFixture(admin, state, user, "archive-rejection", {
    claimed: true,
    archivedList: true,
  });
  const archivedRequest = randomUUID();
  state.callRequestIds.add(archivedRequest);
  const archivedBefore = await readCallSnapshot(admin, archived, [archivedRequest]);
  const archivedResult = await rpc<JsonObject[]>(
    serviceClients(),
    "save_prospect_call_attempt",
    callArgs({
      requestId: archivedRequest,
      fixture: archived,
      user,
      startedAt: new Date().toISOString(),
    }),
  );
  assertRpcMessage(archivedResult.error, "prospect_list_archived");
  const archivedAfter = await readCallSnapshot(admin, archived, [archivedRequest]);
  assert(JSON.stringify(archivedBefore) === JSON.stringify(archivedAfter), "archive rejection wrote data");

  const inactive = await createCallFixture(admin, state, user, "inactive-rejection", {
    claimed: true,
  });
  const inactiveRequest = randomUUID();
  state.callRequestIds.add(inactiveRequest);
  const inactiveBefore = await readCallSnapshot(admin, inactive, [inactiveRequest]);
  await requireData(
    "disable exact fixture profile",
    admin
      .from("app_users")
      .update({ is_active: false, disabled_at: new Date().toISOString() })
      .eq("id", user.id)
      .eq("email", user.email)
      .select("id")
      .single(),
  );
  const inactiveResult = await rpc<JsonObject[]>(
    serviceClients(),
    "save_prospect_call_attempt",
    callArgs({
      requestId: inactiveRequest,
      fixture: inactive,
      user,
      startedAt: new Date().toISOString(),
    }),
  );
  assertRpcMessage(inactiveResult.error, "actor_inactive");
  const inactiveAfter = await readCallSnapshot(admin, inactive, [inactiveRequest]);
  assert(JSON.stringify(inactiveBefore) === JSON.stringify(inactiveAfter), "inactive rejection wrote data");
  await requireData(
    "restore exact fixture profile",
    admin
      .from("app_users")
      .update({ is_active: true, disabled_at: null })
      .eq("id", user.id)
      .eq("email", user.email)
      .select("id")
      .single(),
  );

  checks.call_rejections_zero_write = true;
  checks.call_state_kpi_audit_release = true;
}

async function testRpcAcl(input: {
  supabaseUrl: string;
  publishableKey: string;
  state: State;
  user: FixtureUser;
}): Promise<void> {
  const anon = makeClient(input.supabaseUrl, input.publishableKey);
  const authenticated = makeClient(input.supabaseUrl, input.publishableKey);
  const signedIn = await authenticated.auth.signInWithPassword({
    email: input.user.email,
    password: input.user.password,
  });
  assert(!signedIn.error && signedIn.data.user?.id === input.user.id, "fixture login failed");

  const safeMissingId = randomUUID();
  const safeAclCalls: Array<{ name: string; args: JsonObject }> = [
    {
      name: "save_prospect_call_attempt",
      args: {
        p_request_id: randomUUID(),
        p_membership_id: safeMissingId,
        p_prospect_id: randomUUID(),
        p_contact_id: null,
        p_performed_by: input.user.id,
        p_result: "connected",
        p_note: null,
        p_started_at: new Date().toISOString(),
        p_next_contact_at: null,
        p_clear_next_contact: false,
        p_phone_used: null,
        p_phone_normalized: null,
      },
    },
    {
      name: "claim_next_prospect_call",
      args: { p_user_id: null, p_list_id: null, p_lease_seconds: 60, p_filter: "eligible" },
    },
    {
      name: "release_prospect_call_claim",
      args: { p_membership_id: null, p_user_id: null },
    },
    {
      name: "start_prospect_import_job",
      args: {
        p_import_job_id: randomUUID(),
        p_expected_list_id: randomUUID(),
        p_actor_id: input.user.id,
        p_actor_name: input.user.displayName,
        p_column_mapping: {},
      },
    },
    {
      name: "archive_prospect_list_if_idle",
      args: {
        p_list_id: randomUUID(),
        p_actor_id: input.user.id,
        p_actor_name: input.user.displayName,
      },
    },
    {
      name: "fail_prospect_import_job_if_current",
      args: {
        p_import_job_id: randomUUID(),
        p_list_id: randomUUID(),
        p_queue_job_id: randomUUID(),
        p_worker_id: `${input.state.marker} acl finalizer`,
        p_actor_id: input.user.id,
        p_actor_name: input.user.displayName,
      },
    },
    {
      name: "process_prospect_import_chunk_atomic",
      args: {
        p_import_job_id: randomUUID(),
        p_list_id: randomUUID(),
        p_queue_job_id: randomUUID(),
        p_worker_id: `${input.state.marker} acl`,
        p_cursor_row_number: 0,
        p_actor_id: input.user.id,
        p_actor_name: input.user.displayName,
        p_rows: [],
      },
    },
  ];

  for (const client of [anon, authenticated]) {
    for (const call of safeAclCalls) {
      const result = await rpc(client, call.name, call.args);
      assert(isAclRejection(result.error), `${call.name} was executable by a public role`);
      assert(result.data === null, `${call.name} returned public-role data`);
    }
  }
  await authenticated.auth.signOut();
  checks.rpc_acl_service_only = true;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createImportList(
  admin: Client,
  state: State,
  user: FixtureUser,
  label: string,
): Promise<string> {
  const listId = randomUUID();
  state.listIds.add(listId);
  await requireData(
    `insert import list ${label}`,
    admin
      .from("prospect_lists")
      .insert({
        id: listId,
        name: `${state.marker} import ${label}`,
        description: state.marker,
        status: "active",
        source_type: "csv",
        source_name: state.marker,
        owner_user_id: user.id,
        created_by: user.id,
      })
      .select("id")
      .single(),
  );
  return listId;
}

async function createValidatingImport(input: {
  admin: Client;
  state: State;
  user: FixtureUser;
  listId: string;
  label: string;
  rows: NormalizedImportRow[];
}): Promise<string> {
  const importJobId = randomUUID();
  input.state.importJobIds.add(importJobId);
  const storagePath = `prospects/${input.user.id}/${importJobId}/${input.state.runId}.csv`;
  await requireData(
    `insert import job ${input.label}`,
    input.admin
      .from("prospect_import_jobs")
      .insert({
        id: importJobId,
        prospect_list_id: input.listId,
        file_name: `${input.state.marker} ${input.label}.csv`,
        storage_path: storagePath,
        file_size: input.rows.length,
        file_sha256: sha256(`${input.state.runId}:${input.label}`),
        encoding: "UTF-8",
        column_mapping: { companyName: "会社名" },
        status: "validating",
        total_rows: input.rows.length,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_by: input.user.id,
      })
      .select("id")
      .single(),
  );

  for (const row of input.rows) input.state.importRowIds.add(row.rowId);
  const stagedRows = input.rows.map((row) => ({
    id: row.rowId,
    prospect_import_job_id: importJobId,
    row_number: row.rowNumber,
    raw: { fixture: input.state.runId, row: row.rowNumber },
    staged: row,
    status: "pending",
    source_record_id: row.externalRecordId,
    source_row_hash: null,
  }));
  const inserted = await requireData<JsonObject[]>(
    `insert import rows ${input.label}`,
    input.admin.from("prospect_import_rows").insert(stagedRows).select("id"),
  );
  assert(inserted.length === stagedRows.length, "fixture import row count mismatch");
  return importJobId;
}

function normalizedRow(input: {
  state: State;
  rowNumber: number;
  companyName: string;
  normalizedDomain: string | null;
  sourceHash: string;
}): NormalizedImportRow {
  return {
    rowId: randomUUID(),
    rowNumber: input.rowNumber,
    core: {
      companyName: input.companyName,
      normalizedCompanyName: input.companyName.toLowerCase(),
      websiteUrl: input.normalizedDomain ? `https://${input.normalizedDomain}` : null,
      normalizedDomain: input.normalizedDomain,
      mainPhone: null,
      normalizedPhone: null,
      postalCode: null,
      prefecture: null,
      city: null,
      address: null,
      industry: null,
      employeeRange: null,
      searchText: input.companyName,
    },
    contact: {},
    sourceRowHash: input.sourceHash,
    sourceAttributes: { fixture: input.state.runId, row: input.rowNumber },
    externalRecordId: `${input.state.runId}:${input.rowNumber}`,
    notes: null,
    formalMatch: {},
  };
}

async function setQueueLease(input: {
  admin: Client;
  state: State;
  queueJobId: string;
  workerId: string;
}): Promise<void> {
  input.state.queueJobIds.add(input.queueJobId);
  const leased = await requireData<JsonObject>(
    "lease exact fixture queue job",
    input.admin
      .from("jobs")
      .update({
        status: "running",
        locked_by: input.workerId,
        locked_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        lease_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        attempts: 1,
      })
      .eq("id", input.queueJobId)
      .eq("kind", "prospect_csv_import")
      .eq("status", "queued")
      .select("id")
      .single(),
  );
  assert(leased.id === input.queueJobId, "fixture queue lease mismatch");
}

async function finishQueueJob(admin: Client, queueJobId: string): Promise<void> {
  await requireData(
    "finish exact fixture queue job",
    admin
      .from("jobs")
      .update({
        status: "succeeded",
        locked_by: null,
        locked_at: null,
        heartbeat_at: null,
        lease_expires_at: null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", queueJobId)
      .eq("kind", "prospect_csv_import")
      .select("id")
      .single(),
  );
}

async function exhaustFixtureQueueLease(input: {
  admin: Client;
  queueJobId: string;
  workerId: string;
}): Promise<void> {
  await requireData(
    "exhaust exact fixture queue attempts",
    input.admin
      .from("jobs")
      .update({ attempts: 5, max_attempts: 5 })
      .eq("id", input.queueJobId)
      .eq("kind", "prospect_csv_import")
      .eq("status", "running")
      .eq("locked_by", input.workerId)
      .select("id")
      .single(),
  );
}

async function markFixtureQueueFailed(input: {
  admin: Client;
  queueJobId: string;
  workerId: string;
}): Promise<void> {
  await requireData(
    "fail exact fixture queue job",
    input.admin
      .from("jobs")
      .update({
        status: "failed",
        error_message: "fixture terminal queue failure",
        locked_by: null,
        locked_at: null,
        heartbeat_at: null,
        lease_expires_at: null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", input.queueJobId)
      .eq("kind", "prospect_csv_import")
      .eq("status", "running")
      .eq("locked_by", input.workerId)
      .select("id")
      .single(),
  );
}

function failImportArgs(input: {
  importJobId: string;
  listId: string;
  queueJobId: string;
  workerId: string;
  user: FixtureUser;
}): JsonObject {
  return {
    p_import_job_id: input.importJobId,
    p_list_id: input.listId,
    p_queue_job_id: input.queueJobId,
    p_worker_id: input.workerId,
    p_actor_id: input.user.id,
    p_actor_name: input.user.displayName,
  };
}

function startImportArgs(input: {
  importJobId: string;
  listId: string;
  user: FixtureUser;
}): JsonObject {
  return {
    p_import_job_id: input.importJobId,
    p_expected_list_id: input.listId,
    p_actor_id: input.user.id,
    p_actor_name: input.user.displayName,
    p_column_mapping: { companyName: "会社名" },
  };
}

function archiveListArgs(listId: string, user: FixtureUser): JsonObject {
  return {
    p_list_id: listId,
    p_actor_id: user.id,
    p_actor_name: user.displayName,
  };
}

function processChunkArgs(input: {
  importJobId: string;
  listId: string;
  queueJobId: string;
  workerId: string;
  cursor: number;
  user: FixtureUser;
  rows: NormalizedImportRow[];
}): JsonObject {
  return {
    p_import_job_id: input.importJobId,
    p_list_id: input.listId,
    p_queue_job_id: input.queueJobId,
    p_worker_id: input.workerId,
    p_cursor_row_number: input.cursor,
    p_actor_id: input.user.id,
    p_actor_name: input.user.displayName,
    p_rows: input.rows,
  };
}

async function readImportBusinessSnapshot(
  admin: Client,
  listId: string,
  importJobId: string,
  actorId: string,
): Promise<JsonObject> {
  const memberships = await requireData<JsonObject[]>(
    "snapshot import memberships",
    admin
      .from("prospect_list_memberships")
      .select("id,prospect_id,source_row_hash,source_record_id,source_attributes,stage")
      .eq("prospect_list_id", listId)
      .order("id"),
  );
  const membershipIds = unique(
    memberships.map((row) => asString(row.id, "snapshot membership id")),
  );
  const prospectIds = unique(
    memberships.map((row) => asString(row.prospect_id, "snapshot prospect id")),
  );
  const [list, importJob, rows, prospects, contacts, attempts, queueJobs, audits] =
    await Promise.all([
    requireData<JsonObject>(
      "snapshot import list",
      admin.from("prospect_lists").select("status,archived_at").eq("id", listId).single(),
    ),
    requireData<JsonObject>(
      "snapshot import job",
      admin
        .from("prospect_import_jobs")
        .select("status,total_rows,accepted_count,reused_count,probable_duplicate_count,invalid_count,skipped_count,active_queue_job_id")
        .eq("id", importJobId)
        .single(),
    ),
    requireData<JsonObject[]>(
      "snapshot import rows",
      admin
        .from("prospect_import_rows")
        .select("id,status,prospect_id,membership_id,source_row_hash,match_reason")
        .eq("prospect_import_job_id", importJobId)
        .order("row_number"),
    ),
    requireData<JsonObject[]>(
      "snapshot import prospects",
      admin
        .from("prospects")
        .select("id,company_name,normalized_company_name,normalized_domain,do_not_contact,phone_invalid,archived_at")
        .in("id", prospectIds)
        .order("id"),
    ),
    requireData<JsonObject[]>(
      "snapshot import contacts",
      admin
        .from("prospect_contacts")
        .select("id,prospect_id,name,email,phone,archived_at")
        .in("prospect_id", prospectIds)
        .order("id"),
    ),
    requireData<JsonObject[]>(
      "snapshot import call attempts",
      admin
        .from("prospect_call_attempts")
        .select("id,membership_id,result,archived_at")
        .in("membership_id", membershipIds)
        .order("id"),
    ),
    requireData<JsonObject[]>(
      "snapshot import queue jobs",
      admin
        .from("jobs")
        .select("id,status,progress_done,progress_total,cursor,idempotency_key")
        .contains("payload", { importJobId })
        .order("id"),
    ),
    requireData<JsonObject[]>(
      "snapshot fixture audit",
      admin
        .from("audit_logs")
        .select("id,action,entity_type,changed_fields,request_id")
        .eq("actor_id", actorId)
        .order("id"),
    ),
  ]);
  return {
    list,
    importJob,
    rows,
    memberships,
    prospects,
    contacts,
    attempts,
    queueJobs,
    audits,
  };
}

async function testImportTransactions(input: {
  admin: Client;
  serviceClients: () => Client;
  state: State;
  user: FixtureUser;
}): Promise<void> {
  const { admin, serviceClients, state, user } = input;

  const raceListId = await createImportList(admin, state, user, "start-archive-race");
  const raceRow = normalizedRow({
    state,
    rowNumber: 1,
    companyName: `${state.marker} race company`,
    normalizedDomain: `${randomUUID()}.invalid`,
    sourceHash: sha256(`${state.runId}:race`),
  });
  const raceImportId = await createValidatingImport({
    admin,
    state,
    user,
    listId: raceListId,
    label: "start-archive-race",
    rows: [raceRow],
  });
  const legacyQueueProbeId = randomUUID();
  state.queueJobIds.add(legacyQueueProbeId);
  const legacyQueueProbe = await admin
    .from("jobs")
    .insert({
      id: legacyQueueProbeId,
      kind: "prospect_csv_import",
      priority: 40,
      payload: {
        importJobId: raceImportId,
        listId: raceListId,
        cursorRowNumber: 0,
        actorId: user.id,
        actorName: user.displayName,
        fixtureProbe: state.runId,
      },
      idempotency_key: `prospect_csv_import:${raceImportId}:legacy-probe:${state.runId}`,
      created_by: user.id,
    })
    .select("id");
  assert(legacyQueueProbe.error, "legacy prospect import enqueue unexpectedly succeeded");
  assert(
    legacyQueueProbe.error.message.includes("atomic_prospect_import_enqueue_required"),
    "legacy prospect import enqueue failed for an unexpected reason",
  );
  const legacyQueueProbeRows = await requireData<JsonObject[]>(
    "verify rejected legacy queue absence",
    admin.from("jobs").select("id").eq("id", legacyQueueProbeId),
  );
  assert(legacyQueueProbeRows.length === 0, "rejected legacy queue row exists");
  checks.import_legacy_enqueue_rejected = true;
  const [startRace, archiveRace] = await Promise.all([
    rpc<JsonObject>(
      serviceClients(),
      "start_prospect_import_job",
      startImportArgs({ importJobId: raceImportId, listId: raceListId, user }),
    ),
    rpc<JsonObject>(
      serviceClients(),
      "archive_prospect_list_if_idle",
      archiveListArgs(raceListId, user),
    ),
  ]);
  assert(!startRace.error && startRace.data, "start/archive start RPC failed");
  assert(!archiveRace.error && archiveRace.data, "start/archive archive RPC failed");
  const startOutcome = asString(startRace.data.outcome, "start outcome");
  const archiveOutcome = asString(archiveRace.data.outcome, "archive outcome");
  const startWon = startOutcome === "started" && archiveOutcome === "import_in_progress";
  const archiveWon = startOutcome === "list_unavailable" && archiveOutcome === "archived";
  assert(startWon || archiveWon, "start/archive race violated the atomic outcomes");

  const raceList = await requireData<JsonObject>(
    "verify race list",
    admin.from("prospect_lists").select("status,archived_at").eq("id", raceListId).single(),
  );
  const raceImport = await requireData<JsonObject>(
    "verify race import",
    admin
      .from("prospect_import_jobs")
      .select("status,active_queue_job_id,total_rows")
      .eq("id", raceImportId)
      .single(),
  );
  if (startWon) {
    assert(raceList.status === "active" && raceList.archived_at === null, "start winner list state mismatch");
    assert(raceImport.status === "ready", "start winner import state mismatch");
    const queueId = asString(raceImport.active_queue_job_id, "race active queue id");
    state.queueJobIds.add(queueId);
  } else {
    assert(raceList.status === "archived" && raceList.archived_at, "archive winner list state mismatch");
    assert(raceImport.status === "failed", "archive winner import state mismatch");
    assert(raceImport.active_queue_job_id === null, "archive winner unexpectedly queued work");
  }
  const raceQueueRows = await requireData<JsonObject[]>(
    "verify race queue count",
    admin.from("jobs").select("id,payload,idempotency_key").contains("payload", {
      importJobId: raceImportId,
    }),
  );
  assert(raceQueueRows.length === (startWon ? 1 : 0), "start/archive queue count mismatch");
  for (const row of raceQueueRows) state.queueJobIds.add(asString(row.id, "race queue id"));
  const retryStart = await requireRpc<JsonObject>(
    "retry race import start",
    serviceClients(),
    "start_prospect_import_job",
    startImportArgs({ importJobId: raceImportId, listId: raceListId, user }),
  );
  assert(
    retryStart.outcome === (startWon ? "already_started" : "terminal"),
    "start retry was not idempotent",
  );
  const raceQueueAfter = await requireData<JsonObject[]>(
    "verify race retry queue count",
    admin.from("jobs").select("id").contains("payload", { importJobId: raceImportId }),
  );
  assert(raceQueueAfter.length === raceQueueRows.length, "start retry duplicated a queue job");
  checks.csv_start_archive_atomic = true;

  const chunkListId = await createImportList(admin, state, user, "atomic-chunk");
  const existingProspectId = randomUUID();
  const existingMembershipId = randomUUID();
  state.prospectIds.add(existingProspectId);
  state.membershipIds.add(existingMembershipId);
  const existingDomain = `${randomUUID()}.invalid`;
  await requireData(
    "insert existing fixture prospect",
    admin
      .from("prospects")
      .insert({
        id: existingProspectId,
        company_name: `${state.marker} existing import company`,
        normalized_company_name: `${state.runId}-existing`,
        website_url: `https://${existingDomain}`,
        normalized_domain: existingDomain,
        search_text: `${state.marker} existing`,
        created_by: user.id,
      })
      .select("id")
      .single(),
  );
  await requireData(
    "insert existing fixture membership",
    admin
      .from("prospect_list_memberships")
      .insert({
        id: existingMembershipId,
        prospect_list_id: chunkListId,
        prospect_id: existingProspectId,
        stage: "new",
        source_record_id: `${state.runId}:existing`,
        source_row_hash: null,
        source_attributes: { fixture: state.runId },
      })
      .select("id")
      .single(),
  );

  const reusedSourceHash = sha256(`${state.runId}:reused-source`);
  const chunkRows: NormalizedImportRow[] = [
    normalizedRow({
      state,
      rowNumber: 1,
      companyName: `${state.marker} accepted import company`,
      normalizedDomain: `${randomUUID()}.invalid`,
      sourceHash: sha256(`${state.runId}:accepted-source`),
    }),
    normalizedRow({
      state,
      rowNumber: 2,
      companyName: `${state.marker} reused import company`,
      normalizedDomain: existingDomain,
      sourceHash: reusedSourceHash,
    }),
  ];
  for (let rowNumber = 3; rowNumber <= 41; rowNumber += 1) {
    chunkRows.push(
      normalizedRow({
        state,
        rowNumber,
        companyName: `${state.marker} skipped import company ${rowNumber}`,
        normalizedDomain: null,
        sourceHash: reusedSourceHash,
      }),
    );
  }
  const chunkImportId = await createValidatingImport({
    admin,
    state,
    user,
    listId: chunkListId,
    label: "atomic-chunk",
    rows: chunkRows,
  });
  const started = await requireRpc<JsonObject>(
    "start atomic import",
    serviceClients(),
    "start_prospect_import_job",
    startImportArgs({ importJobId: chunkImportId, listId: chunkListId, user }),
  );
  assert(started.outcome === "started", "atomic import did not start");
  const firstQueueId = asString(started.queueJobId, "first queue id");
  state.queueJobIds.add(firstQueueId);
  const workerId = `${state.marker} worker`;
  await setQueueLease({ admin, state, queueJobId: firstQueueId, workerId });

  const firstChunkArgs = processChunkArgs({
    importJobId: chunkImportId,
    listId: chunkListId,
    queueJobId: firstQueueId,
    workerId,
    cursor: 0,
    user,
    rows: chunkRows,
  });
  const duplicateChunkResults = await Promise.all([
    rpc<JsonObject>(serviceClients(), "process_prospect_import_chunk_atomic", firstChunkArgs),
    rpc<JsonObject>(serviceClients(), "process_prospect_import_chunk_atomic", firstChunkArgs),
  ]);
  assert(duplicateChunkResults.every((result) => !result.error), "duplicate chunk RPC failed");
  const duplicateOutcomes = duplicateChunkResults.map((result) =>
    asString(result.data?.outcome, "duplicate chunk outcome"),
  );
  assert(
    duplicateOutcomes.filter((outcome) => outcome === "processed").length === 1 &&
      duplicateOutcomes.filter((outcome) => outcome === "stale_noop").length === 1,
    "duplicate chunk was not exactly once",
  );
  const processed = duplicateChunkResults.find((result) => result.data?.outcome === "processed")?.data;
  assert(processed, "processed chunk result missing");
  assert(asNumber(processed.accepted, "first accepted") === 1, "first accepted counter mismatch");
  assert(asNumber(processed.reused, "first reused") === 1, "first reused counter mismatch");
  assert(asNumber(processed.skipped, "first skipped") === 38, "first skipped counter mismatch");
  const secondQueueId = asString(processed.nextQueueJobId, "second queue id");
  state.queueJobIds.add(secondQueueId);
  await finishQueueJob(admin, firstQueueId);
  await setQueueLease({ admin, state, queueJobId: secondQueueId, workerId });
  checks.import_duplicate_chunk_exactly_once = true;

  const secondChunkArgs = processChunkArgs({
    importJobId: chunkImportId,
    listId: chunkListId,
    queueJobId: secondQueueId,
    workerId,
    cursor: asNumber(processed.nextCursor, "first next cursor"),
    user,
    rows: chunkRows,
  });
  const [finalChunk, archiveDuringChunk] = await Promise.all([
    rpc<JsonObject>(serviceClients(), "process_prospect_import_chunk_atomic", secondChunkArgs),
    rpc<JsonObject>(
      serviceClients(),
      "archive_prospect_list_if_idle",
      archiveListArgs(chunkListId, user),
    ),
  ]);
  assert(!finalChunk.error && finalChunk.data?.outcome === "completed", "final chunk did not complete");
  assert(!archiveDuringChunk.error && archiveDuringChunk.data, "archive during chunk failed");
  const archiveDuringOutcome = asString(archiveDuringChunk.data.outcome, "archive during chunk outcome");
  assert(
    archiveDuringOutcome === "archived" || archiveDuringOutcome === "import_in_progress",
    "archive during chunk returned an invalid outcome",
  );
  if (archiveDuringOutcome === "import_in_progress") {
    const archivedAfterChunk = await requireRpc<JsonObject>(
      "archive completed import list",
      serviceClients(),
      "archive_prospect_list_if_idle",
      archiveListArgs(chunkListId, user),
    );
    assert(archivedAfterChunk.outcome === "archived", "completed import list was not archived");
  }
  await finishQueueJob(admin, secondQueueId);

  const completedJob = await requireData<JsonObject>(
    "verify completed import counters",
    admin
      .from("prospect_import_jobs")
      .select("status,total_rows,accepted_count,reused_count,probable_duplicate_count,invalid_count,skipped_count,active_queue_job_id")
      .eq("id", chunkImportId)
      .single(),
  );
  assert(completedJob.status === "completed", "import job was not completed");
  assert(asNumber(completedJob.total_rows, "total rows") === 41, "total row count mismatch");
  assert(asNumber(completedJob.accepted_count, "accepted total") === 1, "accepted total mismatch");
  assert(asNumber(completedJob.reused_count, "reused total") === 1, "reused total mismatch");
  assert(asNumber(completedJob.skipped_count, "skipped total") === 39, "skipped total mismatch");
  assert(
    asNumber(completedJob.probable_duplicate_count, "probable total") === 0 &&
      asNumber(completedJob.invalid_count, "invalid total") === 0,
    "unexpected import counter",
  );
  assert(completedJob.active_queue_job_id === null, "completed import retained an active queue");

  const completedRows = await requireData<JsonObject[]>(
    "verify completed import rows",
    admin
      .from("prospect_import_rows")
      .select("id,row_number,status,prospect_id,membership_id,source_row_hash,match_reason")
      .eq("prospect_import_job_id", chunkImportId)
      .order("row_number"),
  );
  assert(completedRows.length === 41, "completed import row count mismatch");
  assert(completedRows[0].status === "accepted", "accepted row status mismatch");
  assert(completedRows[1].status === "reused", "reused row status mismatch");
  assert(completedRows[1].prospect_id === existingProspectId, "reused prospect mismatch");
  assert(completedRows[1].membership_id === existingMembershipId, "reused membership mismatch");
  assert(completedRows[1].match_reason === "high:domain", "reuse reason mismatch");
  assert(
    completedRows.slice(2).every(
      (row) =>
        row.status === "skipped" &&
        row.membership_id === existingMembershipId &&
        row.source_row_hash === reusedSourceHash &&
        row.match_reason === "source_row_hash",
    ),
    "source-hash rows did not reuse the exact membership",
  );
  const listMemberships = await requireData<JsonObject[]>(
    "verify import memberships",
    admin
      .from("prospect_list_memberships")
      .select("id,prospect_id,source_row_hash")
      .eq("prospect_list_id", chunkListId)
      .is("archived_at", null),
  );
  assert(listMemberships.length === 2, "import created an unexpected membership count");
  for (const row of listMemberships) {
    state.membershipIds.add(asString(row.id, "import membership id"));
  }
  const createdProspectId = asString(completedRows[0].prospect_id, "accepted prospect id");
  state.prospectIds.add(createdProspectId);
  const createdMembershipId = asString(completedRows[0].membership_id, "accepted membership id");
  state.membershipIds.add(createdMembershipId);
  const queueRows = await requireData<JsonObject[]>(
    "verify import queue jobs",
    admin
      .from("jobs")
      .select("id,kind,status,payload,idempotency_key")
      .contains("payload", { importJobId: chunkImportId })
      .order("created_at"),
  );
  assert(queueRows.length === 2, "import queue job count mismatch");
  assert(queueRows.every((row) => row.kind === "prospect_csv_import"), "unexpected queue kind");
  assert(queueRows.every((row) => row.status === "succeeded"), "fixture queue did not finish");
  checks.import_source_hash_reuse_counters = true;

  const archivedList = await requireData<JsonObject>(
    "verify chunk list archived",
    admin.from("prospect_lists").select("status,archived_at").eq("id", chunkListId).single(),
  );
  assert(archivedList.status === "archived" && archivedList.archived_at, "chunk list is not archived");
  const afterArchiveBefore = await readImportBusinessSnapshot(
    admin,
    chunkListId,
    chunkImportId,
    user.id,
  );
  const terminalRetries = await Promise.all([
    rpc<JsonObject>(serviceClients(), "process_prospect_import_chunk_atomic", secondChunkArgs),
    rpc<JsonObject>(serviceClients(), "process_prospect_import_chunk_atomic", secondChunkArgs),
  ]);
  assert(
    terminalRetries.every(
      (result) => !result.error && result.data?.outcome === "terminal_noop",
    ),
    "post-archive duplicate chunk was not a terminal no-op",
  );
  const afterArchiveAfter = await readImportBusinessSnapshot(
    admin,
    chunkListId,
    chunkImportId,
    user.id,
  );
  assert(
    JSON.stringify(afterArchiveBefore) === JSON.stringify(afterArchiveAfter),
    "post-archive chunk changed business state",
  );
  checks.after_archive_zero_business_writes = true;

  const crossDomain = `${randomUUID()}.invalid`;
  const existingCrossDomain = await requireData<JsonObject[]>(
    "preflight cross-list unique domain",
    admin
      .from("prospects")
      .select("id")
      .eq("normalized_domain", crossDomain)
      .is("archived_at", null),
  );
  assert(existingCrossDomain.length === 0, "cross-list fixture domain is not unique");

  const crossListA = await createImportList(admin, state, user, "cross-list-a");
  const crossListB = await createImportList(admin, state, user, "cross-list-b");
  const crossRowA = normalizedRow({
    state,
    rowNumber: 1,
    companyName: `${state.marker} cross-list company A`,
    normalizedDomain: crossDomain,
    sourceHash: sha256(`${state.runId}:cross-list-a`),
  });
  const crossRowB = normalizedRow({
    state,
    rowNumber: 1,
    companyName: `${state.marker} cross-list company B`,
    normalizedDomain: crossDomain,
    sourceHash: sha256(`${state.runId}:cross-list-b`),
  });
  const crossImportA = await createValidatingImport({
    admin,
    state,
    user,
    listId: crossListA,
    label: "cross-list-a",
    rows: [crossRowA],
  });
  const crossImportB = await createValidatingImport({
    admin,
    state,
    user,
    listId: crossListB,
    label: "cross-list-b",
    rows: [crossRowB],
  });
  const [crossStartedA, crossStartedB] = await Promise.all([
    requireRpc<JsonObject>(
      "start cross-list import A",
      serviceClients(),
      "start_prospect_import_job",
      startImportArgs({ importJobId: crossImportA, listId: crossListA, user }),
    ),
    requireRpc<JsonObject>(
      "start cross-list import B",
      serviceClients(),
      "start_prospect_import_job",
      startImportArgs({ importJobId: crossImportB, listId: crossListB, user }),
    ),
  ]);
  assert(
    crossStartedA.outcome === "started" && crossStartedB.outcome === "started",
    "cross-list fixture imports did not start",
  );
  const crossQueueA = asString(crossStartedA.queueJobId, "cross-list queue A");
  const crossQueueB = asString(crossStartedB.queueJobId, "cross-list queue B");
  const crossWorkerA = `${state.marker} cross worker A`;
  const crossWorkerB = `${state.marker} cross worker B`;
  await Promise.all([
    setQueueLease({
      admin,
      state,
      queueJobId: crossQueueA,
      workerId: crossWorkerA,
    }),
    setQueueLease({
      admin,
      state,
      queueJobId: crossQueueB,
      workerId: crossWorkerB,
    }),
  ]);

  const crossProcessed = await Promise.all([
    rpc<JsonObject>(
      serviceClients(),
      "process_prospect_import_chunk_atomic",
      processChunkArgs({
        importJobId: crossImportA,
        listId: crossListA,
        queueJobId: crossQueueA,
        workerId: crossWorkerA,
        cursor: 0,
        user,
        rows: [crossRowA],
      }),
    ),
    rpc<JsonObject>(
      serviceClients(),
      "process_prospect_import_chunk_atomic",
      processChunkArgs({
        importJobId: crossImportB,
        listId: crossListB,
        queueJobId: crossQueueB,
        workerId: crossWorkerB,
        cursor: 0,
        user,
        rows: [crossRowB],
      }),
    ),
  ]);
  assert(crossProcessed.every((result) => !result.error), "cross-list chunk RPC failed");
  assert(
    crossProcessed.every((result) => result.data?.outcome === "completed"),
    "cross-list chunk did not complete",
  );
  const crossAccepted = crossProcessed.reduce(
    (sum, result) => sum + asNumber(result.data?.accepted, "cross-list accepted"),
    0,
  );
  const crossReused = crossProcessed.reduce(
    (sum, result) => sum + asNumber(result.data?.reused, "cross-list reused"),
    0,
  );
  assert(crossAccepted === 1 && crossReused === 1, "cross-list dedupe was not serialized");
  assert(
    crossProcessed.every(
      (result) =>
        asNumber(result.data?.probable, "cross-list probable") === 0 &&
        asNumber(result.data?.invalid, "cross-list invalid") === 0 &&
        asNumber(result.data?.skipped, "cross-list skipped") === 0 &&
        asNumber(result.data?.failed, "cross-list failed") === 0,
    ),
    "cross-list import produced an unexpected outcome count",
  );
  await Promise.all([
    finishQueueJob(admin, crossQueueA),
    finishQueueJob(admin, crossQueueB),
  ]);

  const crossProspects = await requireData<JsonObject[]>(
    "verify cross-list canonical prospect",
    admin
      .from("prospects")
      .select("id,company_name,created_by,normalized_domain")
      .eq("normalized_domain", crossDomain)
      .is("archived_at", null),
  );
  assert(crossProspects.length === 1, "cross-list dedupe created multiple prospects");
  assert(
    typeof crossProspects[0].company_name === "string" &&
      crossProspects[0].company_name.startsWith(state.marker) &&
      crossProspects[0].created_by === user.id,
    "cross-list canonical prospect escaped the fixture",
  );
  const crossProspectId = asString(crossProspects[0].id, "cross-list prospect id");
  state.prospectIds.add(crossProspectId);
  const crossMemberships = await requireData<JsonObject[]>(
    "verify cross-list memberships",
    admin
      .from("prospect_list_memberships")
      .select("id,prospect_list_id,prospect_id")
      .in("prospect_list_id", [crossListA, crossListB])
      .is("archived_at", null),
  );
  assert(crossMemberships.length === 2, "cross-list membership count mismatch");
  const membershipLists = new Set(
    crossMemberships.map((row) => asString(row.prospect_list_id, "cross membership list")),
  );
  assert(
    membershipLists.size === 2 &&
      membershipLists.has(crossListA) &&
      membershipLists.has(crossListB) &&
      crossMemberships.every((row) => row.prospect_id === crossProspectId),
    "cross-list memberships do not share one canonical prospect",
  );
  for (const membership of crossMemberships) {
    state.membershipIds.add(asString(membership.id, "cross-list membership id"));
  }
  const crossJobs = await requireData<JsonObject[]>(
    "verify cross-list import counters",
    admin
      .from("prospect_import_jobs")
      .select("id,status,total_rows,accepted_count,reused_count,active_queue_job_id")
      .in("id", [crossImportA, crossImportB]),
  );
  assert(crossJobs.length === 2, "cross-list import job count mismatch");
  assert(
    crossJobs.every(
      (job) =>
        job.status === "completed" &&
        asNumber(job.total_rows, "cross total rows") === 1 &&
        job.active_queue_job_id === null,
    ),
    "cross-list import terminal state mismatch",
  );
  assert(
    crossJobs.reduce(
      (sum, job) => sum + asNumber(job.accepted_count, "cross accepted total"),
      0,
    ) === 1 &&
      crossJobs.reduce(
        (sum, job) => sum + asNumber(job.reused_count, "cross reused total"),
        0,
      ) === 1,
    "cross-list import counters mismatch",
  );
  checks.import_cross_list_dedupe_serialized = true;

  await testTerminalQueueReconciliation({ admin, serviceClients, state, user });
}

async function testTerminalQueueReconciliation(input: {
  admin: Client;
  serviceClients: () => Client;
  state: State;
  user: FixtureUser;
}): Promise<void> {
  const { admin, serviceClients, state, user } = input;

  const finalizerListId = await createImportList(admin, state, user, "queue-finalizer");
  const finalizerRow = normalizedRow({
    state,
    rowNumber: 1,
    companyName: `${state.marker} queue finalizer company`,
    normalizedDomain: `${randomUUID()}.invalid`,
    sourceHash: sha256(`${state.runId}:queue-finalizer`),
  });
  const finalizerImportId = await createValidatingImport({
    admin,
    state,
    user,
    listId: finalizerListId,
    label: "queue-finalizer",
    rows: [finalizerRow],
  });
  const finalizerStarted = await requireRpc<JsonObject>(
    "start queue-finalizer import",
    serviceClients(),
    "start_prospect_import_job",
    startImportArgs({
      importJobId: finalizerImportId,
      listId: finalizerListId,
      user,
    }),
  );
  assert(finalizerStarted.outcome === "started", "queue-finalizer import did not start");
  const finalizerQueueId = asString(finalizerStarted.queueJobId, "finalizer queue id");
  const finalizerWorkerId = `${state.marker} finalizer worker`;
  await setQueueLease({
    admin,
    state,
    queueJobId: finalizerQueueId,
    workerId: finalizerWorkerId,
  });
  await exhaustFixtureQueueLease({
    admin,
    queueJobId: finalizerQueueId,
    workerId: finalizerWorkerId,
  });
  const finalizerArgs = failImportArgs({
    importJobId: finalizerImportId,
    listId: finalizerListId,
    queueJobId: finalizerQueueId,
    workerId: finalizerWorkerId,
    user,
  });
  const finalized = await requireRpc<JsonObject>(
    "finalize exhausted fixture import",
    serviceClients(),
    "fail_prospect_import_job_if_current",
    finalizerArgs,
  );
  assert(finalized.outcome === "failed", "exhausted fixture import was not finalized");
  const finalizedImport = await requireData<JsonObject>(
    "verify finalized fixture import",
    admin
      .from("prospect_import_jobs")
      .select("status,active_queue_job_id,error_message,finished_at")
      .eq("id", finalizerImportId)
      .single(),
  );
  assert(finalizedImport.status === "failed", "finalized import status mismatch");
  assert(finalizedImport.active_queue_job_id === null, "finalized import retained queue pointer");
  assert(finalizedImport.error_message, "finalized import error message missing");
  assert(finalizedImport.finished_at, "finalized import finish time missing");
  const finalizedRows = await requireData<JsonObject[]>(
    "verify finalizer made no prospect writes",
    admin
      .from("prospect_import_rows")
      .select("status,prospect_id,membership_id")
      .eq("prospect_import_job_id", finalizerImportId),
  );
  assert(
    finalizedRows.length === 1 &&
      finalizedRows[0].status === "pending" &&
      finalizedRows[0].prospect_id === null &&
      finalizedRows[0].membership_id === null,
    "finalizer changed staged business rows",
  );
  const finalizerAuditsBeforeRetry = await requireData<JsonObject[]>(
    "verify finalizer audit",
    admin
      .from("audit_logs")
      .select("id")
      .eq("actor_id", user.id)
      .eq("action", "prospect_import.failed")
      .contains("changed_fields", { entity_id: finalizerImportId }),
  );
  assert(finalizerAuditsBeforeRetry.length === 1, "finalizer audit count mismatch");
  const finalizerRetry = await requireRpc<JsonObject>(
    "retry finalized fixture import",
    serviceClients(),
    "fail_prospect_import_job_if_current",
    finalizerArgs,
  );
  assert(finalizerRetry.outcome === "terminal_noop", "finalizer retry was not idempotent");
  const finalizerAuditsAfterRetry = await requireData<JsonObject[]>(
    "verify finalizer retry audit count",
    admin
      .from("audit_logs")
      .select("id")
      .eq("actor_id", user.id)
      .eq("action", "prospect_import.failed")
      .contains("changed_fields", { entity_id: finalizerImportId }),
  );
  assert(
    finalizerAuditsAfterRetry.length === finalizerAuditsBeforeRetry.length,
    "finalizer retry duplicated audit",
  );
  await markFixtureQueueFailed({
    admin,
    queueJobId: finalizerQueueId,
    workerId: finalizerWorkerId,
  });
  const archivedFinalizerList = await requireRpc<JsonObject>(
    "archive finalized fixture list",
    serviceClients(),
    "archive_prospect_list_if_idle",
    archiveListArgs(finalizerListId, user),
  );
  assert(archivedFinalizerList.outcome === "archived", "finalized import still blocked archive");

  const fallbackListId = await createImportList(admin, state, user, "queue-fallback");
  const fallbackRow = normalizedRow({
    state,
    rowNumber: 1,
    companyName: `${state.marker} queue fallback company`,
    normalizedDomain: `${randomUUID()}.invalid`,
    sourceHash: sha256(`${state.runId}:queue-fallback`),
  });
  const fallbackImportId = await createValidatingImport({
    admin,
    state,
    user,
    listId: fallbackListId,
    label: "queue-fallback",
    rows: [fallbackRow],
  });
  const fallbackStarted = await requireRpc<JsonObject>(
    "start queue-fallback import",
    serviceClients(),
    "start_prospect_import_job",
    startImportArgs({ importJobId: fallbackImportId, listId: fallbackListId, user }),
  );
  assert(fallbackStarted.outcome === "started", "queue-fallback import did not start");
  const fallbackQueueId = asString(fallbackStarted.queueJobId, "fallback queue id");
  const fallbackWorkerId = `${state.marker} fallback worker`;
  await setQueueLease({
    admin,
    state,
    queueJobId: fallbackQueueId,
    workerId: fallbackWorkerId,
  });
  await markFixtureQueueFailed({
    admin,
    queueJobId: fallbackQueueId,
    workerId: fallbackWorkerId,
  });
  const activeBeforeFallback = await requireData<JsonObject>(
    "verify fallback import still active",
    admin
      .from("prospect_import_jobs")
      .select("status,active_queue_job_id")
      .eq("id", fallbackImportId)
      .single(),
  );
  assert(activeBeforeFallback.status === "ready", "fallback import was not left active");
  assert(
    activeBeforeFallback.active_queue_job_id === fallbackQueueId,
    "fallback import queue pointer mismatch",
  );
  const reconciledArchive = await requireRpc<JsonObject>(
    "archive terminal-queue fixture list",
    serviceClients(),
    "archive_prospect_list_if_idle",
    archiveListArgs(fallbackListId, user),
  );
  assert(reconciledArchive.outcome === "archived", "terminal queue was not reconciled during archive");
  const reconciledImport = await requireData<JsonObject>(
    "verify archive fallback import",
    admin
      .from("prospect_import_jobs")
      .select("status,active_queue_job_id,error_message,finished_at")
      .eq("id", fallbackImportId)
      .single(),
  );
  assert(reconciledImport.status === "failed", "archive fallback import status mismatch");
  assert(reconciledImport.active_queue_job_id === null, "archive fallback retained queue pointer");
  assert(reconciledImport.error_message && reconciledImport.finished_at, "archive fallback detail missing");
  const fallbackAudit = await requireData<JsonObject[]>(
    "verify archive fallback audit",
    admin
      .from("audit_logs")
      .select("id,changed_fields")
      .eq("actor_id", user.id)
      .eq("action", "prospect_import.failed")
      .contains("changed_fields", { entity_id: fallbackImportId }),
  );
  assert(fallbackAudit.length === 1, "archive fallback audit count mismatch");
  const fallbackFields = asObject(fallbackAudit[0].changed_fields, "fallback audit fields");
  assert(
    fallbackFields.reason === "terminal_queue_reconciled_during_archive",
    "archive fallback audit reason mismatch",
  );
  const fallbackBusinessRows = await requireData<JsonObject[]>(
    "verify archive fallback made no prospect writes",
    admin
      .from("prospect_import_rows")
      .select("status,prospect_id,membership_id")
      .eq("prospect_import_job_id", fallbackImportId),
  );
  assert(
    fallbackBusinessRows.length === 1 &&
      fallbackBusinessRows[0].status === "pending" &&
      fallbackBusinessRows[0].prospect_id === null &&
      fallbackBusinessRows[0].membership_id === null,
    "archive fallback changed staged business rows",
  );
  checks.import_terminal_queue_reconciled = true;
}

async function captureFixtureAudit(admin: Client, state: State): Promise<void> {
  if (!state.user) return;
  const rows = await requireData<JsonObject[]>(
    "capture retained fixture audit",
    admin
      .from("audit_logs")
      .select("id,actor_id,action")
      .eq("actor_id", state.user.id)
      .order("created_at"),
  );
  for (const row of rows) {
    const id = asString(row.id, "audit id");
    const actorId = asString(row.actor_id, "audit actor id");
    const action = asString(row.action, "audit action");
    assert(actorId === state.user.id, "fixture audit actor mismatch");
    state.auditRows.set(id, { actorId, action });
  }
}

async function discoverFixtureDependencies(admin: Client, state: State): Promise<void> {
  const importIds = unique(state.importJobIds);
  if (importIds.length) {
    const importRows = await requireData<JsonObject[]>(
      "discover fixture import rows",
      admin
        .from("prospect_import_rows")
        .select("id,prospect_import_job_id,prospect_id,membership_id")
        .in("prospect_import_job_id", importIds),
    );
    for (const row of importRows) {
      assert(state.importJobIds.has(asString(row.prospect_import_job_id, "import row job id")), "foreign import row");
      state.importRowIds.add(asString(row.id, "import row id"));
      if (typeof row.membership_id === "string") state.membershipIds.add(row.membership_id);
    }

    for (const importJobId of importIds) {
      const jobs = await requireData<JsonObject[]>(
        "discover fixture queue jobs",
        admin
          .from("jobs")
          .select("id,kind,payload,idempotency_key")
          .contains("payload", { importJobId }),
      );
      for (const job of jobs) {
        const payload = asObject(job.payload, "queue payload");
        assert(job.kind === "prospect_csv_import", "fixture import has a foreign queue kind");
        assert(payload.importJobId === importJobId, "fixture queue import mismatch");
        assert(
          typeof job.idempotency_key === "string" &&
            job.idempotency_key.startsWith(`prospect_csv_import:${importJobId}:`),
          "fixture queue idempotency key mismatch",
        );
        state.queueJobIds.add(asString(job.id, "queue job id"));
      }
    }
  }

  const listIds = unique(state.listIds);
  if (listIds.length) {
    const memberships = await requireData<JsonObject[]>(
      "discover fixture memberships",
      admin
        .from("prospect_list_memberships")
        .select("id,prospect_list_id")
        .in("prospect_list_id", listIds),
    );
    for (const membership of memberships) {
      assert(
        state.listIds.has(asString(membership.prospect_list_id, "membership list id")),
        "foreign membership list",
      );
      state.membershipIds.add(asString(membership.id, "membership id"));
    }
    const imports = await requireData<JsonObject[]>(
      "discover fixture imports",
      admin.from("prospect_import_jobs").select("id,prospect_list_id").in("prospect_list_id", listIds),
    );
    for (const importJob of imports) {
      assert(
        state.listIds.has(asString(importJob.prospect_list_id, "import list id")),
        "foreign import list",
      );
      state.importJobIds.add(asString(importJob.id, "import job id"));
    }
  }

  const requestIds = unique(state.callRequestIds);
  if (requestIds.length) {
    const attempts = await requireData<JsonObject[]>(
      "discover fixture call attempts",
      admin
        .from("prospect_call_attempts")
        .select("id,request_id,membership_id,performed_by")
        .in("request_id", requestIds),
    );
    for (const attempt of attempts) {
      assert(state.callRequestIds.has(asString(attempt.request_id, "attempt request id")), "foreign request id");
      assert(
        typeof attempt.membership_id === "string" && state.membershipIds.has(attempt.membership_id),
        "fixture attempt membership mismatch",
      );
      assert(attempt.performed_by === state.user?.id, "fixture attempt actor mismatch");
      state.callAttemptIds.add(asString(attempt.id, "call attempt id"));
    }
  }

  const prospectIdsFromMemberships = new Set<string>();
  const membershipIds = unique(state.membershipIds);
  if (membershipIds.length) {
    const memberships = await requireData<JsonObject[]>(
      "read fixture membership prospects",
      admin
        .from("prospect_list_memberships")
        .select("id,prospect_list_id,prospect_id")
        .in("id", membershipIds),
    );
    for (const membership of memberships) {
      assert(
        state.listIds.has(asString(membership.prospect_list_id, "fixture membership list")),
        "membership escaped fixture list",
      );
      prospectIdsFromMemberships.add(asString(membership.prospect_id, "fixture membership prospect"));
    }
  }
  if (prospectIdsFromMemberships.size) {
    const prospects = await requireData<JsonObject[]>(
      "guard fixture prospects",
      admin
        .from("prospects")
        .select("id,company_name,created_by")
        .in("id", unique(prospectIdsFromMemberships)),
    );
    for (const prospect of prospects) {
      if (
        typeof prospect.company_name === "string" &&
        prospect.company_name.startsWith(state.marker) &&
        prospect.created_by === state.user?.id
      ) {
        state.prospectIds.add(asString(prospect.id, "owned fixture prospect"));
      }
    }
  }

  const prospectIds = unique(state.prospectIds);
  if (prospectIds.length) {
    const contacts = await requireData<JsonObject[]>(
      "discover fixture contacts",
      admin.from("prospect_contacts").select("id,prospect_id,name").in("prospect_id", prospectIds),
    );
    for (const contact of contacts) {
      assert(state.prospectIds.has(asString(contact.prospect_id, "contact prospect id")), "foreign contact");
      state.contactIds.add(asString(contact.id, "contact id"));
    }
  }
}

async function guardFixtureRows(admin: Client, state: State): Promise<void> {
  if (state.user) {
    const profile = await requireData<JsonObject[]>(
      "guard fixture profile",
      admin
        .from("app_users")
        .select("id,email,display_name,role")
        .eq("id", state.user.id),
    );
    if (profile.length) {
      assert(profile.length === 1, "fixture profile count mismatch");
      assert(profile[0].email === state.user.email, "fixture profile email changed");
      assert(profile[0].display_name === state.user.displayName, "fixture profile name changed");
      assert(profile[0].role === "b", "fixture profile role changed");
    }
  }

  const listIds = unique(state.listIds);
  if (listIds.length) {
    const rows = await requireData<JsonObject[]>(
      "guard fixture lists",
      admin.from("prospect_lists").select("id,name,created_by").in("id", listIds),
    );
    for (const row of rows) {
      assert(typeof row.name === "string" && row.name.startsWith(state.marker), "fixture list name mismatch");
      assert(row.created_by === state.user?.id, "fixture list creator mismatch");
    }
  }

  const prospectIds = unique(state.prospectIds);
  if (prospectIds.length) {
    const rows = await requireData<JsonObject[]>(
      "guard owned fixture prospects",
      admin.from("prospects").select("id,company_name,created_by").in("id", prospectIds),
    );
    for (const row of rows) {
      assert(
        typeof row.company_name === "string" && row.company_name.startsWith(state.marker),
        "fixture prospect name mismatch",
      );
      assert(row.created_by === state.user?.id, "fixture prospect creator mismatch");
    }
  }

  const importIds = unique(state.importJobIds);
  if (importIds.length) {
    const rows = await requireData<JsonObject[]>(
      "guard fixture imports",
      admin
        .from("prospect_import_jobs")
        .select("id,prospect_list_id,file_name,storage_path,created_by")
        .in("id", importIds),
    );
    for (const row of rows) {
      assert(state.listIds.has(asString(row.prospect_list_id, "guard import list")), "fixture import list mismatch");
      assert(
        typeof row.file_name === "string" && row.file_name.startsWith(state.marker),
        "fixture import file name mismatch",
      );
      assert(
        typeof row.storage_path === "string" &&
          row.storage_path.includes(`/${asString(row.id, "guard import id")}/`) &&
          row.storage_path.endsWith(`/${state.runId}.csv`),
        "fixture import storage path mismatch",
      );
      assert(row.created_by === state.user?.id, "fixture import creator mismatch");
    }
  }
}

async function deleteExactIds(
  label: string,
  ids: Iterable<string>,
  deleteRows: (exactIds: string[]) => PromiseLike<QueryResult<JsonObject[]>>,
): Promise<void> {
  const exactIds = unique(ids);
  if (!exactIds.length) return;
  const deleted = await requireData<JsonObject[]>(label, deleteRows(exactIds));
  assert(deleted.length <= exactIds.length, `${label}: exact delete count mismatch`);
  const expectedIds = new Set(exactIds);
  const deletedIds = new Set(deleted.map((row) => asString(row.id, `${label}.id`)));
  assert(deletedIds.size === deleted.length, `${label}: duplicate delete result`);
  assert(
    [...deletedIds].every((id) => expectedIds.has(id)),
    `${label}: exact delete UUID mismatch`,
  );
}

async function verifyIdsAbsent(
  label: string,
  ids: Iterable<string>,
  readRows: (exactIds: string[]) => PromiseLike<QueryResult<JsonObject[]>>,
): Promise<void> {
  const exactIds = unique(ids);
  if (!exactIds.length) return;
  const rows = await requireData<JsonObject[]>(label, readRows(exactIds));
  assert(rows.length === 0, `${label}: fixture rows remain`);
}

async function verifyPreexistingImports(admin: Client, state: State): Promise<void> {
  const ids = unique(state.preexistingImportIds);
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const rows = await requireData<JsonObject[]>(
      "verify preexisting imports",
      admin.from("prospect_import_jobs").select("id").in("id", batch),
    );
    const found = new Set(rows.map((row) => asString(row.id, "preexisting import id")));
    assert(batch.every((id) => found.has(id)), "a preexisting import was removed");
  }
  checks.preexisting_imports_preserved = true;
}

async function cleanup(admin: Client, state: State): Promise<void> {
  await captureFixtureAudit(admin, state);
  await discoverFixtureDependencies(admin, state);
  await guardFixtureRows(admin, state);

  await deleteExactIds("delete fixture import rows", state.importRowIds, (ids) =>
    admin.from("prospect_import_rows").delete().in("id", ids).select("id"),
  );
  await deleteExactIds("delete fixture call attempts", state.callAttemptIds, (ids) =>
    admin.from("prospect_call_attempts").delete().in("id", ids).select("id"),
  );
  await deleteExactIds("delete fixture contacts", state.contactIds, (ids) =>
    admin.from("prospect_contacts").delete().in("id", ids).select("id"),
  );
  await deleteExactIds("delete fixture memberships", state.membershipIds, (ids) =>
    admin.from("prospect_list_memberships").delete().in("id", ids).select("id"),
  );
  await deleteExactIds("delete fixture import jobs", state.importJobIds, (ids) =>
    admin.from("prospect_import_jobs").delete().in("id", ids).select("id"),
  );
  await deleteExactIds("delete fixture queue jobs", state.queueJobIds, (ids) =>
    admin.from("jobs").delete().in("id", ids).select("id"),
  );
  await deleteExactIds("delete fixture prospects", state.prospectIds, (ids) =>
    admin.from("prospects").delete().in("id", ids).select("id"),
  );
  await deleteExactIds("delete fixture lists", state.listIds, (ids) =>
    admin.from("prospect_lists").delete().in("id", ids).select("id"),
  );

  if (state.user) {
    const guardedAuth = await admin.auth.admin.getUserById(state.user.id);
    assert(!guardedAuth.error && guardedAuth.data.user, "fixture Auth identity is missing before cleanup");
    assert(
      guardedAuth.data.user.email?.toLowerCase() === state.user.email &&
        guardedAuth.data.user.user_metadata?.fixture === true &&
        guardedAuth.data.user.user_metadata?.display_name === state.user.displayName,
      "fixture Auth identity changed before cleanup",
    );
    const deletedProfile = await requireData<JsonObject[]>(
      "delete exact fixture profile",
      admin
        .from("app_users")
        .delete()
        .eq("id", state.user.id)
        .eq("email", state.user.email)
        .eq("display_name", state.user.displayName)
        .select("id"),
    );
    assert(deletedProfile.length <= 1, "fixture profile delete count mismatch");
    const authDeleted = await deleteProductionFixtureAuthUser({
      userId: state.user.id,
      email: state.user.email,
    });
    if (!authDeleted.ok) {
      const reconciled = await admin.auth.admin.getUserById(state.user.id);
      const code = String(reconciled.error?.code ?? "").toLowerCase();
      const message = String(reconciled.error?.message ?? "").toLowerCase();
      const confirmedMissing =
        !reconciled.data.user &&
        (code.includes("not_found") || message.includes("not found"));
      if (!confirmedMissing) {
        throw new Error(`fixture Auth cleanup failed: ${authDeleted.code}`);
      }
    }
  }
  checks.cleanup_exact = true;

  await verifyIdsAbsent("verify import rows absent", state.importRowIds, (ids) =>
    admin.from("prospect_import_rows").select("id").in("id", ids),
  );
  await verifyIdsAbsent("verify call attempts absent", state.callAttemptIds, (ids) =>
    admin.from("prospect_call_attempts").select("id").in("id", ids),
  );
  await verifyIdsAbsent("verify contacts absent", state.contactIds, (ids) =>
    admin.from("prospect_contacts").select("id").in("id", ids),
  );
  await verifyIdsAbsent("verify memberships absent", state.membershipIds, (ids) =>
    admin.from("prospect_list_memberships").select("id").in("id", ids),
  );
  await verifyIdsAbsent("verify import jobs absent", state.importJobIds, (ids) =>
    admin.from("prospect_import_jobs").select("id").in("id", ids),
  );
  await verifyIdsAbsent("verify queue jobs absent", state.queueJobIds, (ids) =>
    admin.from("jobs").select("id").in("id", ids),
  );
  await verifyIdsAbsent("verify prospects absent", state.prospectIds, (ids) =>
    admin.from("prospects").select("id").in("id", ids),
  );
  await verifyIdsAbsent("verify lists absent", state.listIds, (ids) =>
    admin.from("prospect_lists").select("id").in("id", ids),
  );

  if (state.user) {
    const profiles = await requireData<JsonObject[]>(
      "verify fixture profile absent",
      admin.from("app_users").select("id").eq("id", state.user.id),
    );
    assert(profiles.length === 0, "fixture profile remains");
    const auth = await admin.auth.admin.getUserById(state.user.id);
    const authCode = String(auth.error?.code ?? "").toLowerCase();
    const authMessage = String(auth.error?.message ?? "").toLowerCase();
    assert(
      !auth.data.user &&
        (authCode.includes("not_found") || authMessage.includes("not found")),
      "fixture Auth identity absence was not confirmed",
    );
  }

  if (state.auditRows.size) {
    const auditIds = unique(state.auditRows.keys());
    const retained = await requireData<JsonObject[]>(
      "verify append-only fixture audit",
      admin.from("audit_logs").select("id,actor_id,action").in("id", auditIds),
    );
    assert(retained.length === auditIds.length, "fixture audit rows were not retained");
    for (const row of retained) {
      const expected = state.auditRows.get(asString(row.id, "retained audit id"));
      assert(expected, "unexpected retained audit row");
      assert(row.actor_id === expected.actorId && row.action === expected.action, "retained audit changed");
    }
    const actions = new Set(retained.map((row) => asString(row.action, "retained audit action")));
    assert(actions.has("prospect.call_attempt.create"), "call audit was not retained");
    assert(actions.has("prospect_import.committed"), "import audit was not retained");
    assert(actions.has("prospect_list.archived"), "archive audit was not retained");
    checks.audit_append_only_retained = true;
  }

  await verifyPreexistingImports(admin, state);
  checks.cleanup_verified = true;
}

async function main(): Promise<void> {
  const environment = validateProductionGuards();
  checks.guards = true;
  const state = makeState();
  const admin = makeClient(environment.supabaseUrl, environment.secretKey);
  const serviceClients = () => makeClient(environment.supabaseUrl, environment.secretKey);
  let failed = false;

  try {
    state.preexistingImportIds = await listAllIds(admin, "prospect_import_jobs");
    const user = await createFixtureUser(admin, state);
    checks.fixture_identity = true;
    await testRpcAcl({
      supabaseUrl: environment.supabaseUrl,
      publishableKey: environment.publishableKey,
      state,
      user,
    });
    await testCallTransactions({ admin, serviceClients, state, user });
    await testImportTransactions({ admin, serviceClients, state, user });
  } catch {
    failed = true;
  } finally {
    try {
      await cleanup(admin, state);
    } catch {
      failed = true;
    }
  }

  checks.ok =
    !failed &&
    Object.entries(checks)
      .filter(([name]) => name !== "ok")
      .every(([, value]) => value);
  if (!checks.ok) process.exitCode = 1;
}

void main()
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(() => {
    console.log(JSON.stringify(checks));
  });
