-- Safe permanent deletion for accepted users created by email invitation.
-- Business data is never cascaded or rewritten. The server-only Admin API
-- deletes Auth only after this migration has transactionally removed app_users.

update public.user_invitations invitation
   set auth_user_id = app_user.id
  from public.app_users app_user
 where invitation.id = app_user.invitation_id
   and invitation.status = 'accepted'
   and invitation.auth_user_id is null
   and invitation.normalized_email = pg_catalog.lower(pg_catalog.btrim(app_user.email));

create table if not exists public.user_permanent_deletion_operations (
  target_user_id uuid primary key,
  actor_id uuid not null,
  actor_name text,
  normalized_email text not null,
  invitation_id uuid not null,
  reason text not null check (reason in ('re-register', 'mistaken_invitation', 'test')),
  status text not null check (status in (
    'prepared', 'profile_deleted', 'auth_delete_failed', 'restore_failed', 'completed'
  )),
  app_user_snapshot jsonb not null,
  invitation_snapshot jsonb not null,
  reference_counts jsonb not null,
  error_detail text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz
);

alter table public.user_permanent_deletion_operations enable row level security;
revoke all on table public.user_permanent_deletion_operations
  from public, anon, authenticated;
grant all on table public.user_permanent_deletion_operations to service_role;

create or replace function public.user_permanent_delete_reference_counts(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_unreviewed_fk_count integer;
begin
  -- Any future FK to app_users must be explicitly reviewed before this feature
  -- can delete anyone. This is intentionally schema-wide and fail-closed.
  select pg_catalog.count(*)::integer
    into v_unreviewed_fk_count
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class source_table
      on source_table.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace source_schema
      on source_schema.oid = source_table.relnamespace
    cross join lateral pg_catalog.unnest(constraint_row.conkey) key_column(attnum)
    join pg_catalog.pg_attribute source_column
      on source_column.attrelid = source_table.oid
     and source_column.attnum = key_column.attnum
   where constraint_row.contype = 'f'
     and constraint_row.confrelid = 'public.app_users'::pg_catalog.regclass
     and (source_schema.nspname, source_table.relname, source_column.attname) not in (
       ('public', 'user_invitations', 'invited_by'),
       ('public', 'user_invitations', 'archived_by'),
       ('public', 'user_admin_operations', 'actor_id'),
       ('public', 'user_admin_operations', 'target_user_id'),
       ('public', 'saved_searches', 'owner_id'),
       ('public', 'recent_views', 'user_id'),
       ('public', 'inquiries', 'assigned_user_id'),
       ('public', 'gmail_oauth_states', 'created_by'),
       ('public', 'inquiry_draft_requests', 'created_by'),
       ('public', 'prospect_lists', 'owner_user_id'),
       ('public', 'prospect_lists', 'created_by'),
       ('public', 'prospects', 'created_by'),
       ('public', 'prospects', 'promoted_by'),
       ('public', 'prospect_list_memberships', 'assigned_user_id'),
       ('public', 'prospect_list_memberships', 'claimed_by'),
       ('public', 'prospect_import_jobs', 'created_by'),
       ('public', 'prospect_call_attempts', 'performed_by')
     );

  return pg_catalog.jsonb_build_object(
    'customer_staff', (select pg_catalog.count(*) from public.customer_index where p_user_id = any(staff_user_ids)),
    'deal_staff', (select pg_catalog.count(*) from public.deal_index where p_user_id = any(staff_user_ids)),
    'contract_staff', (select pg_catalog.count(*) from public.contract_index where p_user_id = any(staff_user_ids)),
    'activity_author_editor', (select pg_catalog.count(*) from public.activity_index where created_by = p_user_id or updated_by = p_user_id),
    'action_assignee_author', (select pg_catalog.count(*) from public.action_index where assignee_user_id = p_user_id or created_by = p_user_id),
    'complaint_assignee', (select pg_catalog.count(*) from public.complaint_index where assignee_user_id = p_user_id),
    'write_operations', (select pg_catalog.count(*) from public.write_operations where actor_id = p_user_id or coalesce(recovery_payload::text, '') like '%' || p_user_id::text || '%'),
    'jobs', (select pg_catalog.count(*) from public.jobs where created_by = p_user_id or payload::text like '%' || p_user_id::text || '%'),
    'import_jobs', (select pg_catalog.count(*) from public.import_jobs where created_by = p_user_id),
    'saved_searches', (select pg_catalog.count(*) from public.saved_searches where owner_id = p_user_id),
    'recent_views', (select pg_catalog.count(*) from public.recent_views where user_id = p_user_id),
    'system_settings', (select pg_catalog.count(*) from public.system_settings where updated_by = p_user_id),
    'inquiries', (select pg_catalog.count(*) from public.inquiries where assigned_user_id = p_user_id),
    'gmail_oauth_states', (select pg_catalog.count(*) from public.gmail_oauth_states where created_by = p_user_id),
    'inquiry_draft_requests', (select pg_catalog.count(*) from public.inquiry_draft_requests where created_by = p_user_id),
    'prospect_lists', (select pg_catalog.count(*) from public.prospect_lists where owner_user_id = p_user_id or created_by = p_user_id),
    'prospects', (select pg_catalog.count(*) from public.prospects where created_by = p_user_id or promoted_by = p_user_id),
    'prospect_assignments', (select pg_catalog.count(*) from public.prospect_list_memberships where assigned_user_id = p_user_id or claimed_by = p_user_id),
    'prospect_import_jobs', (select pg_catalog.count(*) from public.prospect_import_jobs where created_by = p_user_id),
    'prospect_call_attempts', (select pg_catalog.count(*) from public.prospect_call_attempts where performed_by = p_user_id),
    'user_admin_operations', (select pg_catalog.count(*) from public.user_admin_operations where actor_id = p_user_id or target_user_id = p_user_id),
    'invitation_administration', (select pg_catalog.count(*) from public.user_invitations where invited_by = p_user_id or archived_by = p_user_id),
    'storage_objects', (select pg_catalog.count(*) from storage.objects object_row where coalesce(pg_catalog.to_jsonb(object_row)->>'owner_id', pg_catalog.to_jsonb(object_row)->>'owner', '') = p_user_id::text),
    'unreviewed_app_user_foreign_keys', v_unreviewed_fk_count
  );
end $$;

create or replace function public.evaluate_user_permanent_deletion(
  p_actor_id uuid,
  p_target_user_id uuid
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_actor public.app_users;
  v_target public.app_users;
  v_invitation public.user_invitations;
  v_auth auth.users;
  v_counts jsonb;
  v_total bigint;
begin
  select * into v_actor from public.app_users
   where id = p_actor_id and role = 'admin' and is_active;
  if not found then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason_code', 'admin_required');
  end if;

  select * into v_target from public.app_users where id = p_target_user_id;
  if not found then
    if exists (
      select 1 from public.user_permanent_deletion_operations
       where target_user_id = p_target_user_id and status = 'completed'
    ) then
      return pg_catalog.jsonb_build_object('eligible', false, 'reason_code', 'already_deleted');
    end if;
    return pg_catalog.jsonb_build_object('eligible', false, 'reason_code', 'user_not_found');
  end if;

  if p_actor_id = p_target_user_id then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason_code', 'self_delete');
  end if;
  if v_target.invitation_id is null then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason_code', 'not_invited_origin');
  end if;
  if v_target.role = 'admin' and v_target.is_active and (
    select pg_catalog.count(*) from public.app_users where role = 'admin' and is_active
  ) <= 1 then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason_code', 'last_admin');
  end if;
  if v_target.notion_staff_page_id is not null then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason_code', 'notion_staff_profile_exists');
  end if;

  select * into v_invitation from public.user_invitations where id = v_target.invitation_id;
  if not found
     or v_invitation.status <> 'accepted'
     or v_invitation.auth_user_id is distinct from v_target.id
     or v_invitation.normalized_email <> pg_catalog.lower(pg_catalog.btrim(v_target.email)) then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason_code', 'invitation_identity_mismatch');
  end if;

  select * into v_auth from auth.users where id = v_target.id;
  if not found
     or pg_catalog.lower(pg_catalog.btrim(coalesce(v_auth.email, ''))) <> v_invitation.normalized_email
     or coalesce(v_auth.raw_user_meta_data #>> '{invitation_id}', '') <> v_invitation.id::text
     or v_auth.invited_at is null then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason_code', 'auth_identity_mismatch');
  end if;

  v_counts := public.user_permanent_delete_reference_counts(v_target.id);
  if coalesce((v_counts->>'storage_objects')::bigint, 0) > 0 then
    return pg_catalog.jsonb_build_object(
      'eligible', false, 'reason_code', 'storage_owned', 'reference_counts', v_counts
    );
  end if;
  select coalesce(pg_catalog.sum(value::bigint), 0)
    into v_total from pg_catalog.jsonb_each_text(v_counts);
  if v_total > 0 then
    return pg_catalog.jsonb_build_object(
      'eligible', false, 'reason_code', 'business_references', 'reference_counts', v_counts
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'eligible', true,
    'reason_code', 'eligible',
    'invitation_id', v_invitation.id,
    'normalized_email', v_invitation.normalized_email,
    'reference_counts', v_counts
  );
end $$;

create or replace function public.list_user_permanent_delete_eligibility(
  p_actor_id uuid
)
returns table(target_user_id uuid, eligible boolean, reason_code text)
language plpgsql
security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.app_users
     where id = p_actor_id and role = 'admin' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  return query
  select candidate.id,
         coalesce((evaluation.value->>'eligible')::boolean, false),
         coalesce(evaluation.value->>'reason_code', 'state_ambiguous')
    from public.app_users candidate
    cross join lateral (
      select public.evaluate_user_permanent_deletion(p_actor_id, candidate.id) as value
    ) evaluation
   where candidate.invitation_id is not null;
end $$;

create or replace function public.prepare_user_permanent_deletion(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_actor public.app_users;
  v_target public.app_users;
  v_invitation public.user_invitations;
  v_operation public.user_permanent_deletion_operations;
  v_evaluation jsonb;
  v_counts jsonb;
  v_safe_email text;
begin
  if p_reason not in ('re-register', 'mistaken_invitation', 'test') then
    raise exception using errcode = 'P0001', message = 'invalid_reason';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_target_user_id::text, 1960341479)
  );

  select * into v_actor from public.app_users
   where id = p_actor_id and role = 'admin' and is_active
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select * into v_operation
    from public.user_permanent_deletion_operations
   where target_user_id = p_target_user_id
   for update;
  if found and v_operation.status = 'completed' then
    return pg_catalog.jsonb_build_object('state', 'already_deleted');
  end if;
  if found and v_operation.status in ('profile_deleted', 'restore_failed') then
    return pg_catalog.jsonb_build_object(
      'state', 'ready_for_auth_cleanup',
      'auth_user_id', v_operation.target_user_id,
      'normalized_email', v_operation.normalized_email,
      'invitation_id', v_operation.invitation_id
    );
  end if;

  -- Prevent concurrent writers in every reviewed reference table while the
  -- final counts and profile DELETE happen in this transaction.
  lock table
    public.customer_index,
    public.deal_index,
    public.contract_index,
    public.activity_index,
    public.action_index,
    public.complaint_index,
    public.write_operations,
    public.jobs,
    public.import_jobs,
    public.saved_searches,
    public.recent_views,
    public.system_settings,
    public.inquiries,
    public.gmail_oauth_states,
    public.inquiry_draft_requests,
    public.prospect_lists,
    public.prospects,
    public.prospect_list_memberships,
    public.prospect_import_jobs,
    public.prospect_call_attempts,
    public.user_admin_operations,
    public.user_invitations,
    storage.objects
  in share row exclusive mode;

  select * into v_target from public.app_users
   where id = p_target_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;

  v_evaluation := public.evaluate_user_permanent_deletion(p_actor_id, p_target_user_id);
  if not coalesce((v_evaluation->>'eligible')::boolean, false) then
    raise exception using errcode = 'P0001',
      message = coalesce(v_evaluation->>'reason_code', 'state_ambiguous');
  end if;

  select * into v_invitation from public.user_invitations
   where id = v_target.invitation_id for update;
  v_counts := v_evaluation->'reference_counts';
  v_safe_email := case
    when pg_catalog.strpos(v_target.email, '@') > 1
      then pg_catalog.left(v_target.email, 1) || '***@' || pg_catalog.split_part(v_target.email, '@', 2)
    else '***'
  end;

  insert into public.user_permanent_deletion_operations (
    target_user_id, actor_id, actor_name, normalized_email, invitation_id,
    reason, status, app_user_snapshot, invitation_snapshot, reference_counts,
    error_detail, updated_at, completed_at
  ) values (
    v_target.id, v_actor.id, v_actor.display_name,
    pg_catalog.lower(pg_catalog.btrim(v_target.email)), v_invitation.id,
    p_reason, 'prepared', pg_catalog.to_jsonb(v_target), pg_catalog.to_jsonb(v_invitation),
    v_counts, null, pg_catalog.now(), null
  ) on conflict (target_user_id) do update
    set actor_id = excluded.actor_id,
        actor_name = excluded.actor_name,
        normalized_email = excluded.normalized_email,
        invitation_id = excluded.invitation_id,
        reason = excluded.reason,
        status = 'prepared',
        app_user_snapshot = excluded.app_user_snapshot,
        invitation_snapshot = excluded.invitation_snapshot,
        reference_counts = excluded.reference_counts,
        error_detail = null,
        updated_at = pg_catalog.now(),
        completed_at = null;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, changed_fields, operation_source
  ) values (
    v_actor.id,
    v_actor.display_name,
    'user.permanent_delete',
    'app_user',
    pg_catalog.jsonb_build_object(
      'target_user_id', v_target.id,
      'target_email', v_safe_email,
      'invitation_id', v_invitation.id,
      'reason', p_reason,
      'reference_counts', v_counts
    ),
    'permanent_user_deletion_service'
  );

  update public.user_invitations
     set status = 'revoked',
         revoked_at = coalesce(revoked_at, pg_catalog.now()),
         auth_cleanup_status = 'pending',
         auth_cleanup_detail = null
   where id = v_invitation.id;

  delete from public.app_users where id = v_target.id;

  update public.user_permanent_deletion_operations
     set status = 'profile_deleted', updated_at = pg_catalog.now()
   where target_user_id = v_target.id;

  return pg_catalog.jsonb_build_object(
    'state', 'ready_for_auth_cleanup',
    'auth_user_id', v_target.id,
    'normalized_email', pg_catalog.lower(pg_catalog.btrim(v_target.email)),
    'invitation_id', v_invitation.id
  );
end $$;

create or replace function public.restore_user_after_permanent_delete_failure(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_detail text default null
)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  v_operation public.user_permanent_deletion_operations;
  v_auth auth.users;
  v_app jsonb;
  v_inv jsonb;
begin
  if not exists (
    select 1 from public.app_users where id = p_actor_id and role = 'admin' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_target_user_id::text, 1960341479)
  );
  select * into v_operation from public.user_permanent_deletion_operations
   where target_user_id = p_target_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'operation_not_found';
  end if;
  if v_operation.status = 'completed' then return 'already_completed'; end if;

  select * into v_auth from auth.users where id = p_target_user_id;
  if not found
     or pg_catalog.lower(pg_catalog.btrim(coalesce(v_auth.email, ''))) <> v_operation.normalized_email then
    raise exception using errcode = 'P0001', message = 'auth_identity_mismatch';
  end if;

  v_app := v_operation.app_user_snapshot;
  v_inv := v_operation.invitation_snapshot;

  if not exists (select 1 from public.app_users where id = p_target_user_id) then
    if exists (
      select 1 from public.app_users
       where pg_catalog.lower(pg_catalog.btrim(email)) = v_operation.normalized_email
    ) then
      raise exception using errcode = 'P0001', message = 'restore_email_conflict';
    end if;

    insert into public.app_users (
      id, email, display_name, role, department_role, is_active, disabled_at,
      provisioning_status, provisioning_error, notion_staff_page_id,
      invitation_id, created_at, updated_at
    ) values (
      (v_app->>'id')::uuid,
      v_app->>'email',
      v_app->>'display_name',
      (v_app->>'role')::public.app_role,
      v_app->>'department_role',
      (v_app->>'is_active')::boolean,
      (v_app->>'disabled_at')::timestamptz,
      (v_app->>'provisioning_status')::public.provisioning_status,
      v_app->>'provisioning_error',
      v_app->>'notion_staff_page_id',
      (v_app->>'invitation_id')::uuid,
      (v_app->>'created_at')::timestamptz,
      (v_app->>'updated_at')::timestamptz
    );
  end if;

  update public.user_invitations
     set status = (v_inv->>'status')::public.invitation_status,
         accepted_at = (v_inv->>'accepted_at')::timestamptz,
         revoked_at = (v_inv->>'revoked_at')::timestamptz,
         auth_user_id = (v_inv->>'auth_user_id')::uuid,
         archived_at = (v_inv->>'archived_at')::timestamptz,
         archived_by = (v_inv->>'archived_by')::uuid,
         auth_cleanup_status = v_inv->>'auth_cleanup_status',
         auth_cleanup_detail = v_inv->>'auth_cleanup_detail'
   where id = v_operation.invitation_id;

  update public.user_permanent_deletion_operations
     set status = 'auth_delete_failed',
         error_detail = pg_catalog.left(p_detail, 500),
         updated_at = pg_catalog.now()
   where target_user_id = p_target_user_id;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, changed_fields, operation_source
  ) values (
    p_actor_id,
    (select display_name from public.app_users where id = p_actor_id),
    'user.permanent_delete_failed',
    'app_user',
    pg_catalog.jsonb_build_object(
      'target_user_id', p_target_user_id,
      'profile_restored', true,
      'detail', pg_catalog.left(p_detail, 200)
    ),
    'permanent_user_deletion_service'
  );

  return 'restored';
end $$;

create or replace function public.record_permanent_delete_restore_failure(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_detail text default null
)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.app_users where id = p_actor_id and role = 'admin' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  update public.user_permanent_deletion_operations
     set status = 'restore_failed',
         error_detail = pg_catalog.left(p_detail, 500),
         updated_at = pg_catalog.now()
   where target_user_id = p_target_user_id
     and status <> 'completed';
  return found;
end $$;

create or replace function public.finalize_user_permanent_deletion(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_auth_outcome text
)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  v_operation public.user_permanent_deletion_operations;
begin
  if p_auth_outcome not in ('deleted', 'not_found') then
    raise exception using errcode = 'P0001', message = 'invalid_auth_outcome';
  end if;
  if not exists (
    select 1 from public.app_users where id = p_actor_id and role = 'admin' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_target_user_id::text, 1960341479)
  );
  select * into v_operation from public.user_permanent_deletion_operations
   where target_user_id = p_target_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'operation_not_found';
  end if;
  if v_operation.status = 'completed' then return 'already_completed'; end if;
  if exists (select 1 from public.app_users where id = p_target_user_id) then
    raise exception using errcode = 'P0001', message = 'profile_still_exists';
  end if;
  if exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception using errcode = 'P0001', message = 'auth_user_still_exists';
  end if;

  update public.user_invitations
     set status = 'revoked',
         revoked_at = coalesce(revoked_at, pg_catalog.now()),
         auth_cleanup_status = p_auth_outcome,
         auth_cleanup_detail = null
   where id = v_operation.invitation_id;

  update public.user_permanent_deletion_operations
     set status = 'completed',
         error_detail = null,
         updated_at = pg_catalog.now(),
         completed_at = pg_catalog.now()
   where target_user_id = p_target_user_id;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, changed_fields, operation_source
  ) values (
    p_actor_id,
    (select display_name from public.app_users where id = p_actor_id),
    'user.permanent_delete_completed',
    'app_user',
    pg_catalog.jsonb_build_object(
      'target_user_id', p_target_user_id,
      'invitation_id', v_operation.invitation_id,
      'auth_cleanup', p_auth_outcome
    ),
    'permanent_user_deletion_service'
  );

  return 'completed';
end $$;

revoke execute on function public.user_permanent_delete_reference_counts(uuid)
  from public, anon, authenticated;
revoke execute on function public.evaluate_user_permanent_deletion(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.list_user_permanent_delete_eligibility(uuid)
  from public, anon, authenticated;
revoke execute on function public.prepare_user_permanent_deletion(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.restore_user_after_permanent_delete_failure(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.record_permanent_delete_restore_failure(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.finalize_user_permanent_deletion(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.user_permanent_delete_reference_counts(uuid) to service_role;
grant execute on function public.evaluate_user_permanent_deletion(uuid, uuid) to service_role;
grant execute on function public.list_user_permanent_delete_eligibility(uuid) to service_role;
grant execute on function public.prepare_user_permanent_deletion(uuid, uuid, text) to service_role;
grant execute on function public.restore_user_after_permanent_delete_failure(uuid, uuid, text) to service_role;
grant execute on function public.record_permanent_delete_restore_failure(uuid, uuid, text) to service_role;
grant execute on function public.finalize_user_permanent_deletion(uuid, uuid, text) to service_role;
