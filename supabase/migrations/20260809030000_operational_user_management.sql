-- Operational user management
-- Direct provisioning, disable/re-enable, role changes, and admin password reset audit.

alter table public.app_users
  add column if not exists disabled_at timestamptz;

create unique index if not exists app_users_normalized_email_uniq
  on public.app_users ((pg_catalog.lower(pg_catalog.btrim(email))));

create table if not exists public.user_admin_operations (
  request_id uuid primary key,
  kind text not null check (kind in ('direct_create')),
  actor_id uuid not null references public.app_users (id) on delete restrict,
  normalized_email text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  target_user_id uuid references public.app_users (id) on delete restrict,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists user_admin_operations_processing_email_uniq
  on public.user_admin_operations (normalized_email)
  where kind = 'direct_create' and status = 'processing';

alter table public.user_admin_operations enable row level security;
revoke all on table public.user_admin_operations from public, anon, authenticated;
grant all on table public.user_admin_operations to service_role;

create or replace function public.begin_direct_user_provisioning(
  p_actor_id uuid,
  p_request_id uuid,
  p_email text
)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_existing public.user_admin_operations;
begin
  if not exists (
    select 1
      from public.app_users
     where id = p_actor_id
       and role = 'admin'
       and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select * into v_existing
    from public.user_admin_operations
   where request_id = p_request_id;
  if found then
    if v_existing.kind <> 'direct_create'
       or v_existing.actor_id <> p_actor_id
       or v_existing.normalized_email <> v_email then
      raise exception using errcode = 'P0001', message = 'request_conflict';
    end if;
    return v_existing.status;
  end if;

  if exists (
    select 1 from public.app_users
     where pg_catalog.lower(pg_catalog.btrim(email)) = v_email
  ) or exists (
    select 1 from auth.users
     where pg_catalog.lower(pg_catalog.btrim(email)) = v_email
  ) then
    raise exception using errcode = 'P0001', message = 'email_registered';
  end if;

  begin
    insert into public.user_admin_operations (
      request_id, kind, actor_id, normalized_email
    ) values (
      p_request_id, 'direct_create', p_actor_id, v_email
    );
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'email_provisioning';
  end;

  return 'started';
end $$;

create or replace function public.complete_direct_user_provisioning(
  p_actor_id uuid,
  p_request_id uuid,
  p_user_id uuid,
  p_email text,
  p_display_name text,
  p_role public.app_role
)
returns public.app_users
language plpgsql
security definer set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_operation public.user_admin_operations;
  v_app_user public.app_users;
begin
  select * into v_operation
    from public.user_admin_operations
   where request_id = p_request_id
   for update;

  if not found
     or v_operation.kind <> 'direct_create'
     or v_operation.actor_id <> p_actor_id
     or v_operation.normalized_email <> v_email then
    raise exception using errcode = 'P0001', message = 'operation_not_found';
  end if;

  if v_operation.status = 'completed' then
    select * into v_app_user from public.app_users where id = v_operation.target_user_id;
    return v_app_user;
  end if;
  if v_operation.status <> 'processing' then
    raise exception using errcode = 'P0001', message = 'operation_not_processing';
  end if;

  if not exists (
    select 1 from public.app_users
     where id = p_actor_id and role = 'admin' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  if not exists (
    select 1 from auth.users
     where id = p_user_id
       and pg_catalog.lower(pg_catalog.btrim(email)) = v_email
  ) then
    raise exception using errcode = 'P0001', message = 'auth_user_mismatch';
  end if;

  insert into public.app_users (
    id, email, display_name, role, is_active, disabled_at,
    provisioning_status, invitation_id
  ) values (
    p_user_id, v_email, pg_catalog.btrim(p_display_name), p_role, true, null,
    'profile_created', null
  )
  returning * into v_app_user;

  update public.user_admin_operations
     set status = 'completed',
         target_user_id = p_user_id,
         error_code = null,
         completed_at = pg_catalog.now()
   where request_id = p_request_id;

  insert into public.jobs (
    kind, priority, payload, idempotency_key, created_by
  ) values (
    'user_provisioning',
    30,
    pg_catalog.jsonb_build_object('user_id', p_user_id),
    'user_provisioning:' || p_user_id::text,
    p_actor_id
  ) on conflict (idempotency_key) do nothing;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, changed_fields,
    operation_source, request_id
  )
  select p_actor_id, actor.display_name, 'user.direct_create', 'app_user',
    pg_catalog.jsonb_build_object(
      'target_user_id', p_user_id,
      'role', p_role,
      'email', v_email
    ),
    'admin_user_service', p_request_id
  from public.app_users actor where actor.id = p_actor_id;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, changed_fields,
    operation_source, request_id
  )
  select p_actor_id, actor.display_name, 'user.role_assign', 'app_user',
    pg_catalog.jsonb_build_object(
      'target_user_id', p_user_id,
      'role_after', p_role
    ),
    'admin_user_service', p_request_id
  from public.app_users actor where actor.id = p_actor_id;

  return v_app_user;
end $$;

create or replace function public.fail_direct_user_provisioning(
  p_actor_id uuid,
  p_request_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.user_admin_operations
     set status = 'failed',
         error_code = pg_catalog.left(pg_catalog.coalesce(p_error_code, 'unknown'), 80),
         completed_at = pg_catalog.now()
   where request_id = p_request_id
     and actor_id = p_actor_id
     and kind = 'direct_create'
     and status = 'processing';
  return found;
end $$;

create or replace function public.set_app_user_active(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_active boolean
)
returns public.app_users
language plpgsql
security definer set search_path = ''
as $$
declare
  v_actor public.app_users;
  v_target public.app_users;
  v_admin_count bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(2081014517);

  select * into v_actor from public.app_users
   where id = p_actor_id for update;
  if not found or not v_actor.is_active or v_actor.role <> 'admin' then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select * into v_target from public.app_users
   where id = p_target_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;

  if v_target.is_active = p_active then
    raise exception using errcode = 'P0001',
      message = case when p_active then 'already_active' else 'already_inactive' end;
  end if;

  if not p_active then
    if p_actor_id = p_target_user_id then
      raise exception using errcode = 'P0001', message = 'self_disable';
    end if;
    if v_target.role = 'admin' then
      select count(*) into v_admin_count
        from public.app_users where role = 'admin' and is_active;
      if v_admin_count <= 1 then
        raise exception using errcode = 'P0001', message = 'last_admin';
      end if;
    end if;
  end if;

  update public.app_users
     set is_active = p_active,
         disabled_at = case when p_active then null else pg_catalog.now() end
   where id = p_target_user_id
  returning * into v_target;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, changed_fields, operation_source
  ) values (
    v_actor.id,
    v_actor.display_name,
    case when p_active then 'user.reenable' else 'user.disable' end,
    'app_user',
    pg_catalog.jsonb_build_object(
      'target_user_id', p_target_user_id,
      'is_active_before', not p_active,
      'is_active_after', p_active
    ),
    'admin_user_service'
  );

  return v_target;
end $$;

create or replace function public.change_app_user_role(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_role public.app_role
)
returns public.app_users
language plpgsql
security definer set search_path = ''
as $$
declare
  v_actor public.app_users;
  v_target public.app_users;
  v_before public.app_role;
  v_admin_count bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(2081014517);

  select * into v_actor from public.app_users
   where id = p_actor_id for update;
  if not found or not v_actor.is_active or v_actor.role <> 'admin' then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select * into v_target from public.app_users
   where id = p_target_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;
  v_before := v_target.role;

  if v_before = p_role then
    raise exception using errcode = 'P0001', message = 'role_unchanged';
  end if;
  if p_actor_id = p_target_user_id and p_role <> 'admin' then
    raise exception using errcode = 'P0001', message = 'self_demote';
  end if;
  if v_before = 'admin' and p_role <> 'admin' and v_target.is_active then
    select count(*) into v_admin_count
      from public.app_users where role = 'admin' and is_active;
    if v_admin_count <= 1 then
      raise exception using errcode = 'P0001', message = 'last_admin';
    end if;
  end if;

  update public.app_users set role = p_role
   where id = p_target_user_id
  returning * into v_target;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, changed_fields, operation_source
  ) values (
    v_actor.id,
    v_actor.display_name,
    'user.role_change',
    'app_user',
    pg_catalog.jsonb_build_object(
      'target_user_id', p_target_user_id,
      'role_before', v_before,
      'role_after', p_role
    ),
    'admin_user_service'
  );

  return v_target;
end $$;

create or replace function public.record_admin_password_reset(
  p_actor_id uuid,
  p_target_user_id uuid
)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  v_actor public.app_users;
begin
  select * into v_actor from public.app_users
   where id = p_actor_id and role = 'admin' and is_active;
  if not found then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  if not exists (select 1 from public.app_users where id = p_target_user_id) then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, changed_fields, operation_source
  ) values (
    v_actor.id,
    v_actor.display_name,
    'user.password_reset_by_admin',
    'app_user',
    pg_catalog.jsonb_build_object('target_user_id', p_target_user_id),
    'admin_user_service'
  );
  return true;
end $$;

revoke execute on function public.begin_direct_user_provisioning(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.complete_direct_user_provisioning(uuid, uuid, uuid, text, text, public.app_role)
  from public, anon, authenticated;
revoke execute on function public.fail_direct_user_provisioning(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.set_app_user_active(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.change_app_user_role(uuid, uuid, public.app_role)
  from public, anon, authenticated;
revoke execute on function public.record_admin_password_reset(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.begin_direct_user_provisioning(uuid, uuid, text)
  to service_role;
grant execute on function public.complete_direct_user_provisioning(uuid, uuid, uuid, text, text, public.app_role)
  to service_role;
grant execute on function public.fail_direct_user_provisioning(uuid, uuid, text)
  to service_role;
grant execute on function public.set_app_user_active(uuid, uuid, boolean)
  to service_role;
grant execute on function public.change_app_user_role(uuid, uuid, public.app_role)
  to service_role;
grant execute on function public.record_admin_password_reset(uuid, uuid)
  to service_role;
