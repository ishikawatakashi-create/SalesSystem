-- Safe invitation cancellation and invitation-history archiving.
-- Auth user deletion remains in the server-only Admin API; these RPCs provide
-- the transactional permission, state, profile, activity and business-reference guards.

alter table public.user_invitations
  add column if not exists auth_user_id uuid,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.app_users (id) on delete restrict,
  add column if not exists auth_cleanup_status text not null default 'not_requested'
    check (auth_cleanup_status in (
      'not_requested', 'pending', 'deleted', 'not_found', 'skipped', 'failed'
    )),
  add column if not exists auth_cleanup_detail text;

create index if not exists user_invitations_auth_user_id_idx
  on public.user_invitations (auth_user_id)
  where auth_user_id is not null;

create index if not exists user_invitations_visible_created_idx
  on public.user_invitations (created_at desc)
  where archived_at is null;

create or replace function public.invitation_user_has_business_references(
  p_user_id uuid
)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
begin
  -- Notion-backed operational indexes.
  if exists (select 1 from public.customer_index where p_user_id = any(staff_user_ids))
    or exists (select 1 from public.deal_index where p_user_id = any(staff_user_ids))
    or exists (select 1 from public.contract_index where p_user_id = any(staff_user_ids))
    or exists (select 1 from public.activity_index where created_by = p_user_id or updated_by = p_user_id)
    or exists (select 1 from public.action_index where assignee_user_id = p_user_id or created_by = p_user_id)
    or exists (select 1 from public.complaint_index where assignee_user_id = p_user_id)
    -- Application operational data.
    or exists (select 1 from public.write_operations where actor_id = p_user_id)
    or exists (select 1 from public.audit_logs where actor_id = p_user_id)
    or exists (select 1 from public.jobs where created_by = p_user_id)
    or exists (select 1 from public.import_jobs where created_by = p_user_id)
    or exists (select 1 from public.saved_searches where owner_id = p_user_id)
    or exists (select 1 from public.recent_views where user_id = p_user_id)
    or exists (select 1 from public.system_settings where updated_by = p_user_id)
    or exists (select 1 from public.inquiries where assigned_user_id = p_user_id)
    or exists (select 1 from public.gmail_oauth_states where created_by = p_user_id)
    or exists (select 1 from public.inquiry_draft_requests where created_by = p_user_id)
    -- Prospect operations.
    or exists (
      select 1 from public.prospect_lists
       where owner_user_id = p_user_id or created_by = p_user_id
    )
    or exists (
      select 1 from public.prospects
       where created_by = p_user_id or promoted_by = p_user_id
    )
    or exists (
      select 1 from public.prospect_list_memberships
       where assigned_user_id = p_user_id or claimed_by = p_user_id
    )
    or exists (select 1 from public.prospect_import_jobs where created_by = p_user_id)
    or exists (select 1 from public.prospect_call_attempts where performed_by = p_user_id)
    -- Direct-create bookkeeping is also activation evidence.
    or exists (
      select 1 from public.user_admin_operations
       where actor_id = p_user_id or target_user_id = p_user_id
    )
  then
    return true;
  end if;

  return false;
end $$;

create or replace function public.prepare_invitation_cancellation(
  p_actor_id uuid,
  p_invitation_id uuid
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_actor public.app_users;
  v_invitation public.user_invitations;
  v_auth auth.users;
  v_retry_cleanup boolean := false;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_invitation_id::text, 2081014518)
  );

  select * into v_actor
    from public.app_users
   where id = p_actor_id
   for update;
  if not found or not v_actor.is_active or v_actor.role <> 'admin' then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select * into v_invitation
    from public.user_invitations
   where id = p_invitation_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invitation_not_found';
  end if;

  if v_invitation.status = 'revoked' then
    if v_invitation.auth_cleanup_status in ('pending', 'failed') then
      v_retry_cleanup := true;
    else
      return pg_catalog.jsonb_build_object(
        'state', 'already_cancelled',
        'auth_user_id', v_invitation.auth_user_id,
        'normalized_email', v_invitation.normalized_email
      );
    end if;
  elsif v_invitation.status = 'accepted' then
    raise exception using errcode = 'P0001', message = 'invitation_accepted';
  elsif v_invitation.status = 'expired' or v_invitation.expires_at < pg_catalog.now() then
    raise exception using errcode = 'P0001', message = 'invitation_expired';
  elsif v_invitation.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invitation_state_ambiguous';
  end if;

  -- A formal profile, including one linked by email or invitation, always wins.
  if exists (
    select 1
      from public.app_users
     where id = v_invitation.auth_user_id
        or invitation_id = v_invitation.id
        or pg_catalog.lower(pg_catalog.btrim(email)) = v_invitation.normalized_email
  ) then
    raise exception using errcode = 'P0001', message = 'invitation_profile_exists';
  end if;

  -- Deletion without a persisted one-to-one Auth mapping is intentionally refused.
  if v_invitation.auth_user_id is null then
    raise exception using errcode = 'P0001', message = 'invitation_state_ambiguous';
  end if;

  select * into v_auth
    from auth.users
   where id = v_invitation.auth_user_id;

  if not found then
    if not v_retry_cleanup then
      update public.user_invitations
         set status = 'revoked',
             revoked_at = coalesce(revoked_at, pg_catalog.now()),
             auth_cleanup_status = 'not_found',
             auth_cleanup_detail = null
       where id = v_invitation.id;

      insert into public.audit_logs (
        actor_id, actor_name, action, entity_type, changed_fields, operation_source
      ) values (
        v_actor.id,
        v_actor.display_name,
        'user.invite_cancel',
        'user_invitation',
        pg_catalog.jsonb_build_object(
          'invitation_id', v_invitation.id,
          'auth_user_id', v_invitation.auth_user_id,
          'auth_cleanup', 'not_found'
        ),
        'invitation_admin_service'
      );
    else
      update public.user_invitations
         set auth_cleanup_status = 'not_found', auth_cleanup_detail = null
       where id = v_invitation.id;
    end if;

    return pg_catalog.jsonb_build_object(
      'state', 'cancelled_no_auth_user',
      'auth_user_id', v_invitation.auth_user_id,
      'normalized_email', v_invitation.normalized_email
    );
  end if;

  if pg_catalog.lower(pg_catalog.btrim(coalesce(v_auth.email, ''))) <> v_invitation.normalized_email
     or coalesce(v_auth.raw_user_meta_data #>> '{invitation_id}', '') <> v_invitation.id::text
     or v_auth.invited_at is null
  then
    raise exception using errcode = 'P0001', message = 'invitation_state_ambiguous';
  end if;

  if v_auth.email_confirmed_at is not null
     or v_auth.confirmed_at is not null
     or v_auth.last_sign_in_at is not null
  then
    raise exception using errcode = 'P0001', message = 'invitation_auth_activated';
  end if;

  if public.invitation_user_has_business_references(v_invitation.auth_user_id) then
    raise exception using errcode = 'P0001', message = 'invitation_business_data_exists';
  end if;

  if not v_retry_cleanup then
    update public.user_invitations
       set status = 'revoked',
           revoked_at = coalesce(revoked_at, pg_catalog.now()),
           auth_cleanup_status = 'pending',
           auth_cleanup_detail = null
     where id = v_invitation.id;

    insert into public.audit_logs (
      actor_id, actor_name, action, entity_type, changed_fields, operation_source
    ) values (
      v_actor.id,
      v_actor.display_name,
      'user.invite_cancel',
      'user_invitation',
      pg_catalog.jsonb_build_object(
        'invitation_id', v_invitation.id,
        'auth_user_id', v_invitation.auth_user_id,
        'status_before', 'pending',
        'status_after', 'revoked'
      ),
      'invitation_admin_service'
    );
  else
    update public.user_invitations
       set auth_cleanup_status = 'pending', auth_cleanup_detail = null
     where id = v_invitation.id;
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'ready_for_auth_cleanup',
    'auth_user_id', v_invitation.auth_user_id,
    'normalized_email', v_invitation.normalized_email
  );
end $$;

create or replace function public.record_invitation_auth_cleanup(
  p_actor_id uuid,
  p_invitation_id uuid,
  p_cleanup_status text,
  p_detail text default null
)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  v_actor public.app_users;
  v_invitation public.user_invitations;
begin
  if p_cleanup_status not in ('deleted', 'not_found', 'skipped', 'failed') then
    raise exception using errcode = 'P0001', message = 'invalid_cleanup_status';
  end if;

  select * into v_actor from public.app_users
   where id = p_actor_id and role = 'admin' and is_active;
  if not found then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select * into v_invitation from public.user_invitations
   where id = p_invitation_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invitation_not_found';
  end if;
  if v_invitation.status <> 'revoked' then
    raise exception using errcode = 'P0001', message = 'invitation_not_cancelled';
  end if;

  -- A concurrent duplicate call must not overwrite a completed result.
  if v_invitation.auth_cleanup_status in ('deleted', 'not_found', 'skipped') then
    return true;
  end if;

  update public.user_invitations
     set auth_cleanup_status = p_cleanup_status,
         auth_cleanup_detail = case
           when p_cleanup_status in ('failed', 'skipped') then pg_catalog.left(p_detail, 500)
           else null
         end
   where id = p_invitation_id;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, changed_fields, operation_source
  ) values (
    v_actor.id,
    v_actor.display_name,
    'user.invite_auth_cleanup',
    'user_invitation',
    pg_catalog.jsonb_build_object(
      'invitation_id', p_invitation_id,
      'auth_user_id', v_invitation.auth_user_id,
      'cleanup_status', p_cleanup_status,
      'detail', case
        when p_cleanup_status in ('failed', 'skipped') then pg_catalog.left(p_detail, 500)
        else null
      end
    ),
    'invitation_admin_service'
  );

  return true;
end $$;

create or replace function public.archive_invitation_history(
  p_actor_id uuid,
  p_invitation_id uuid
)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  v_actor public.app_users;
  v_invitation public.user_invitations;
begin
  select * into v_actor from public.app_users
   where id = p_actor_id and role = 'admin' and is_active;
  if not found then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select * into v_invitation from public.user_invitations
   where id = p_invitation_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invitation_not_found';
  end if;
  if v_invitation.archived_at is not null then
    return 'already_archived';
  end if;

  if v_invitation.status = 'pending' and v_invitation.expires_at >= pg_catalog.now() then
    raise exception using errcode = 'P0001', message = 'invitation_still_pending';
  end if;

  update public.user_invitations
     set status = case
           when status = 'pending' then 'expired'::public.invitation_status
           else status
         end,
         archived_at = pg_catalog.now(),
         archived_by = v_actor.id
   where id = v_invitation.id;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, changed_fields, operation_source
  ) values (
    v_actor.id,
    v_actor.display_name,
    'user.invite_history_archive',
    'user_invitation',
    pg_catalog.jsonb_build_object(
      'invitation_id', v_invitation.id,
      'status', v_invitation.status
    ),
    'invitation_admin_service'
  );

  return 'archived';
end $$;

revoke execute on function public.invitation_user_has_business_references(uuid)
  from public, anon, authenticated;
revoke execute on function public.prepare_invitation_cancellation(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.record_invitation_auth_cleanup(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.archive_invitation_history(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.invitation_user_has_business_references(uuid)
  to service_role;
grant execute on function public.prepare_invitation_cancellation(uuid, uuid)
  to service_role;
grant execute on function public.record_invitation_auth_cleanup(uuid, uuid, text, text)
  to service_role;
grant execute on function public.archive_invitation_history(uuid, uuid)
  to service_role;
