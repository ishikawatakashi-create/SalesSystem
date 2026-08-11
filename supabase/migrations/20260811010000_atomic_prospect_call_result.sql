-- Phase 13B P0: 架電結果保存を単一transactionへ集約する。
-- 既存migrationは適用済みのため、このforward-only migrationでRPCとACLを追加・是正する。

alter table public.prospect_call_attempts
  add column if not exists input_snapshot jsonb,
  add column if not exists result_snapshot jsonb;

comment on column public.prospect_call_attempts.input_snapshot is
  'Canonical save input used to distinguish an exact idempotent retry from a request_id conflict.';
comment on column public.prospect_call_attempts.result_snapshot is
  'Immutable first-success response returned by exact idempotent retries.';

create or replace function public.save_prospect_call_attempt(
  p_request_id uuid,
  p_membership_id uuid,
  p_prospect_id uuid,
  p_contact_id uuid,
  p_performed_by uuid,
  p_result text,
  p_note text,
  p_started_at timestamptz,
  p_next_contact_at timestamptz,
  p_clear_next_contact boolean,
  p_phone_used text,
  p_phone_normalized text
)
returns table (
  attempt_id uuid,
  duplicated boolean,
  stage text,
  promote_cta_strong boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_actor public.app_users%rowtype;
  v_list public.prospect_lists%rowtype;
  v_prospect public.prospects%rowtype;
  v_membership public.prospect_list_memberships%rowtype;
  v_existing public.prospect_call_attempts%rowtype;
  v_membership_list_id uuid;
  v_membership_prospect_id uuid;
  v_attempt_id uuid;
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_phone_used text := nullif(pg_catalog.btrim(p_phone_used), '');
  v_phone_normalized text := nullif(pg_catalog.btrim(p_phone_normalized), '');
  v_clear_next_contact boolean := coalesce(p_clear_next_contact, false);
  v_attempt_next_contact_at timestamptz;
  v_membership_next_contact_at timestamptz;
  v_next_stage text;
  v_promote_cta_strong boolean := false;
  v_set_do_not_contact boolean := false;
  v_set_phone_invalid boolean := false;
  v_input_snapshot jsonb;
  v_existing_input_snapshot jsonb;
  v_result_snapshot jsonb;
  v_retry_stage text;
  v_retry_promote_cta_strong boolean;
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'request_id_required';
  end if;
  if p_membership_id is null then
    raise exception using errcode = 'P0001', message = 'membership_not_found';
  end if;
  if p_prospect_id is null then
    raise exception using errcode = 'P0001', message = 'prospect_not_found';
  end if;
  if p_performed_by is null then
    raise exception using errcode = 'P0001', message = 'actor_not_found';
  end if;

  if p_result is null or p_result not in (
    'no_answer', 'busy', 'gatekeeper', 'contact_absent', 'callback_requested',
    'connected', 'send_materials', 'interested', 'appointment',
    'not_interested', 'wrong_number', 'do_not_contact', 'other'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_call_result';
  end if;

  -- 折返し希望は、clear指定を含め、次回連絡日時なしでは保存させない。
  if p_result = 'callback_requested'
     and (p_next_contact_at is null or v_clear_next_contact) then
    raise exception using errcode = 'P0001', message = 'next_contact_required';
  end if;

  if v_phone_used is null then
    v_phone_normalized := null;
  end if;
  v_attempt_next_contact_at := case
    when v_clear_next_contact then null
    else p_next_contact_at
  end;

  v_input_snapshot := pg_catalog.jsonb_build_object(
    'prospect_id', p_prospect_id,
    'membership_id', p_membership_id,
    'contact_id', p_contact_id,
    'performed_by', p_performed_by,
    'result', p_result,
    'note', v_note,
    'started_at', p_started_at,
    'next_contact_at', v_attempt_next_contact_at,
    'clear_next_contact', v_clear_next_contact,
    'phone_used', v_phone_used,
    'phone_normalized', v_phone_normalized,
    'source', 'manual_call'
  );

  -- 同一request_idの並行実行を、対象行がまだ存在しない時点から直列化する。
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 13013)
  );

  -- Exact retryは現在のactor/claim/list状態より先に、初回snapshotだけで判定する。
  -- service_role限定RPCなので、HTTP応答喪失後の安全な再取得を優先する。
  select existing.*
    into v_existing
    from public.prospect_call_attempts existing
   where existing.request_id = p_request_id::text;
  if found then
    v_existing_input_snapshot := coalesce(
      v_existing.input_snapshot,
      pg_catalog.jsonb_build_object(
        'prospect_id', v_existing.prospect_id,
        'membership_id', v_existing.membership_id,
        'contact_id', v_existing.contact_id,
        'performed_by', v_existing.performed_by,
        'result', v_existing.result,
        'note', v_existing.note,
        'started_at', v_existing.started_at,
        'next_contact_at', v_existing.next_contact_at,
        'clear_next_contact', v_existing.clear_next_contact,
        'phone_used', v_existing.phone_used,
        'phone_normalized', v_existing.phone_normalized,
        'source', v_existing.source
      )
    );

    if v_existing_input_snapshot is distinct from v_input_snapshot then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;

    if v_existing.result_snapshot is not null then
      v_retry_stage := v_existing.result_snapshot ->> 'stage';
      v_retry_promote_cta_strong := coalesce(
        (v_existing.result_snapshot ->> 'promote_cta_strong')::boolean,
        false
      );
    else
      -- 適用前の既存行だけはsnapshotがないため、後方互換fallbackを許容する。
      select membership.stage
        into v_retry_stage
        from public.prospect_list_memberships membership
       where membership.id = v_existing.membership_id;
      v_retry_stage := coalesce(v_retry_stage, 'working');
      v_retry_promote_cta_strong := v_existing.result in ('interested', 'appointment');
    end if;

    return query
      select v_existing.id, true, v_retry_stage, v_retry_promote_cta_strong;
    return;
  end if;

  -- 新規保存ではActorを業務行より先に共有lockし、処理中の無効化・権限変更を防ぐ。
  select actor.*
    into v_actor
    from public.app_users actor
   where actor.id = p_performed_by
   for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'actor_not_found';
  end if;
  if not v_actor.is_active then
    raise exception using errcode = 'P0001', message = 'actor_inactive';
  end if;
  if v_actor.provisioning_status not in ('profile_created', 'completed') then
    raise exception using errcode = 'P0001', message = 'actor_not_provisioned';
  end if;
  if v_actor.role not in ('admin', 'a', 'b') then
    raise exception using errcode = 'P0001', message = 'actor_forbidden';
  end if;

  -- 固定順 list(SHARE) -> prospect(UPDATE) -> membership(UPDATE) でlockする。
  -- list SHAREはarchive/importのUPDATEと競合しつつ、同一listの無関係な架電保存は並行可能。
  select membership.prospect_list_id, membership.prospect_id
    into v_membership_list_id, v_membership_prospect_id
    from public.prospect_list_memberships membership
   where membership.id = p_membership_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'membership_not_found';
  end if;
  if v_membership_prospect_id <> p_prospect_id then
    raise exception using errcode = 'P0001', message = 'membership_prospect_mismatch';
  end if;

  select prospect_list.*
    into v_list
    from public.prospect_lists prospect_list
   where prospect_list.id = v_membership_list_id
   for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'prospect_list_not_found';
  end if;
  if v_list.archived_at is not null or v_list.status = 'archived' then
    raise exception using errcode = 'P0001', message = 'prospect_list_archived';
  end if;

  select prospect.*
    into v_prospect
    from public.prospects prospect
   where prospect.id = p_prospect_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'prospect_not_found';
  end if;

  select membership.*
    into v_membership
    from public.prospect_list_memberships membership
   where membership.id = p_membership_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'membership_not_found';
  end if;
  if v_membership.prospect_list_id <> v_list.id
     or v_membership.prospect_id <> p_prospect_id then
    raise exception using errcode = 'P0001', message = 'membership_prospect_mismatch';
  end if;

  if v_membership.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'membership_archived';
  end if;
  if v_prospect.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'prospect_archived';
  end if;
  if v_prospect.do_not_contact then
    raise exception using errcode = 'P0001', message = 'prospect_do_not_contact';
  end if;
  if coalesce(v_prospect.promotion_status, 'none') in (
    'completed', 'pending', 'organization_created', 'contacts_done',
    'activity_done', 'action_done'
  ) then
    raise exception using errcode = 'P0001', message = 'prospect_promotion_ineligible';
  end if;
  if v_membership.assigned_user_id is distinct from p_performed_by then
    raise exception using errcode = 'P0001', message = 'membership_not_assigned_to_user';
  end if;
  if v_membership.stage not in ('new', 'assigned', 'working') then
    raise exception using errcode = 'P0001', message = 'membership_stage_ineligible';
  end if;

  -- 保存時点で「actor本人が所有し、期限が未来」のleaseを厳格に要求する。
  if v_membership.claimed_by is distinct from p_performed_by then
    if v_membership.claimed_by is not null
       and v_membership.claim_expires_at is not null
       and v_membership.claim_expires_at > v_now then
      raise exception using errcode = 'P0001', message = 'call_claim_conflict';
    end if;
    raise exception using errcode = 'P0001', message = 'call_claim_required';
  end if;
  if v_membership.claim_expires_at is null
     or v_membership.claim_expires_at <= v_now then
    raise exception using errcode = 'P0001', message = 'call_claim_required';
  end if;

  if p_contact_id is not null then
    perform 1
      from public.prospect_contacts contact
     where contact.id = p_contact_id
       and contact.prospect_id = p_prospect_id
       and contact.archived_at is null
     for share;
    if not found then
      raise exception using errcode = 'P0001', message = 'contact_mismatch';
    end if;
  end if;

  v_next_stage := case
    when p_result in (
      'no_answer', 'busy', 'gatekeeper', 'contact_absent',
      'callback_requested', 'connected', 'send_materials'
    ) then 'working'
    when p_result in ('interested', 'appointment') then 'qualified'
    when p_result = 'not_interested' then 'disqualified'
    else v_membership.stage
  end;
  v_promote_cta_strong := p_result in ('interested', 'appointment');
  v_set_do_not_contact := p_result = 'do_not_contact';
  v_set_phone_invalid := p_result = 'wrong_number';

  v_membership_next_contact_at := case
    when v_clear_next_contact then null
    when p_next_contact_at is not null then p_next_contact_at
    else v_membership.next_contact_at
  end;
  v_result_snapshot := pg_catalog.jsonb_build_object(
    'stage', v_next_stage,
    'promote_cta_strong', v_promote_cta_strong
  );

  insert into public.prospect_call_attempts (
    prospect_id,
    membership_id,
    contact_id,
    performed_by,
    result,
    note,
    started_at,
    completed_at,
    next_contact_at,
    clear_next_contact,
    phone_used,
    phone_normalized,
    source,
    request_id,
    input_snapshot,
    result_snapshot
  ) values (
    p_prospect_id,
    p_membership_id,
    p_contact_id,
    p_performed_by,
    p_result,
    v_note,
    p_started_at,
    v_now,
    v_attempt_next_contact_at,
    v_clear_next_contact,
    v_phone_used,
    v_phone_normalized,
    'manual_call',
    p_request_id::text,
    v_input_snapshot,
    v_result_snapshot
  )
  returning id into v_attempt_id;

  update public.prospect_list_memberships membership
     set stage = v_next_stage,
         next_contact_at = v_membership_next_contact_at,
         last_contact_at = v_now,
         last_call_result = p_result,
         call_count = coalesce(v_membership.call_count, 0) + 1,
         claimed_by = null,
         claimed_at = null,
         claim_expires_at = null,
         updated_at = v_now
   where membership.id = p_membership_id;

  if v_set_do_not_contact then
    update public.prospects prospect
       set do_not_contact = true,
           do_not_contact_reason = coalesce(v_note, '架電結果: 営業連絡不要'),
           do_not_contact_at = v_now,
           updated_at = v_now
     where prospect.id = p_prospect_id;

    insert into public.audit_logs (
      actor_id,
      actor_name,
      action,
      entity_type,
      notion_page_id,
      changed_fields,
      operation_source,
      request_id,
      batch_id
    ) values (
      p_performed_by,
      v_actor.display_name,
      'prospect.dnc_set',
      'prospect',
      null,
      pg_catalog.jsonb_build_object(
        'do_not_contact', true,
        'prospect_id', p_prospect_id,
        'prospect_list_id', v_list.id,
        'membership_id', p_membership_id,
        'result', p_result,
        'reason', coalesce(v_note, '架電結果: 営業連絡不要'),
        'do_not_contact_before', v_prospect.do_not_contact,
        'do_not_contact_after', true,
        'reason_before', v_prospect.do_not_contact_reason,
        'reason_after', coalesce(v_note, '架電結果: 営業連絡不要'),
        'entity_id', p_prospect_id
      ),
      'app',
      p_request_id,
      null
    );
  end if;

  if v_set_phone_invalid then
    update public.prospects prospect
       set phone_invalid = true,
           updated_at = v_now
     where prospect.id = p_prospect_id;
  end if;

  insert into public.audit_logs (
    actor_id,
    actor_name,
    action,
    entity_type,
    notion_page_id,
    changed_fields,
    operation_source,
    request_id,
    batch_id
  ) values (
    p_performed_by,
    v_actor.display_name,
    'prospect.call_attempt.create',
    'prospect',
    null,
    pg_catalog.jsonb_build_object(
      'attempt_id', v_attempt_id,
      'prospect_id', p_prospect_id,
      'prospect_list_id', v_list.id,
      'membership_id', p_membership_id,
      'result', p_result,
      'stage', v_next_stage,
      'next_contact_at', v_membership_next_contact_at,
      'clear_next_contact', v_clear_next_contact,
      'contact_id', p_contact_id,
      'has_note', v_note is not null,
      'stage_before', v_membership.stage,
      'stage_after', v_next_stage,
      'next_contact_at_before', v_membership.next_contact_at,
      'next_contact_at_after', v_membership_next_contact_at,
      'last_contact_at_before', v_membership.last_contact_at,
      'last_contact_at_after', v_now,
      'last_call_result_before', v_membership.last_call_result,
      'last_call_result_after', p_result,
      'call_count_before', coalesce(v_membership.call_count, 0),
      'call_count_after', coalesce(v_membership.call_count, 0) + 1,
      'claimed_by_before', v_membership.claimed_by,
      'claimed_by_after', null,
      'claimed_at_before', v_membership.claimed_at,
      'claimed_at_after', null,
      'claim_expires_at_before', v_membership.claim_expires_at,
      'claim_expires_at_after', null,
      'do_not_contact_before', v_prospect.do_not_contact,
      'do_not_contact_after', v_prospect.do_not_contact or v_set_do_not_contact,
      'do_not_contact_reason_before', v_prospect.do_not_contact_reason,
      'do_not_contact_reason_after', case
        when v_set_do_not_contact then coalesce(v_note, '架電結果: 営業連絡不要')
        else v_prospect.do_not_contact_reason
      end,
      'do_not_contact_at_before', v_prospect.do_not_contact_at,
      'do_not_contact_at_after', case
        when v_set_do_not_contact then v_now
        else v_prospect.do_not_contact_at
      end,
      'phone_invalid_before', v_prospect.phone_invalid,
      'phone_invalid_after', v_prospect.phone_invalid or v_set_phone_invalid,
      'entity_id', p_prospect_id
    ),
    'app',
    p_request_id,
    null
  );

  return query
    select v_attempt_id, false, v_next_stage, v_promote_cta_strong;
end;
$$;

revoke all on function public.save_prospect_call_attempt(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  boolean, text, text
) from public, anon, authenticated;
grant execute on function public.save_prospect_call_attempt(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  boolean, text, text
) to service_role;

-- claim候補からアーカイブ済みlistを除外する。paused/draftの運用意味論は変更しない。
create or replace function public.claim_next_prospect_call(
  p_user_id uuid,
  p_list_id uuid default null,
  p_lease_seconds int default 600,
  p_filter text default 'eligible'
)
returns setof public.prospect_list_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.prospect_list_memberships;
  v_now timestamptz := pg_catalog.now();
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;

  update public.prospect_list_memberships
     set claimed_by = null,
         claimed_at = null,
         claim_expires_at = null,
         updated_at = v_now
   where claimed_by is not null
     and claim_expires_at is not null
     and claim_expires_at < v_now
     and archived_at is null;

  select membership.*
    into j
    from public.prospect_list_memberships membership
    join public.prospect_lists prospect_list
      on prospect_list.id = membership.prospect_list_id
    join public.prospects prospect
      on prospect.id = membership.prospect_id
   where membership.archived_at is null
     and prospect_list.archived_at is null
     and prospect_list.status <> 'archived'
     and prospect.archived_at is null
     and prospect.do_not_contact = false
     and coalesce(prospect.promotion_status, 'none') not in (
       'completed', 'pending', 'organization_created', 'contacts_done',
       'activity_done', 'action_done'
     )
     and membership.assigned_user_id = p_user_id
     and membership.stage in ('new', 'assigned', 'working')
     and (p_list_id is null or membership.prospect_list_id = p_list_id)
     and (
       membership.claimed_by is null
       or membership.claimed_by = p_user_id
       or membership.claim_expires_at is null
       or membership.claim_expires_at < v_now
     )
     and (
       p_filter = 'all'
       or (
         p_filter = 'overdue'
         and membership.next_contact_at is not null
         and membership.next_contact_at <
           pg_catalog.date_trunc('day', v_now at time zone 'Asia/Tokyo')
             at time zone 'Asia/Tokyo'
       )
       or (
         p_filter = 'today'
         and membership.next_contact_at is not null
         and membership.next_contact_at >=
           pg_catalog.date_trunc('day', v_now at time zone 'Asia/Tokyo')
             at time zone 'Asia/Tokyo'
         and membership.next_contact_at <
           (pg_catalog.date_trunc('day', v_now at time zone 'Asia/Tokyo')
             + interval '1 day') at time zone 'Asia/Tokyo'
       )
       or (
         p_filter = 'no_schedule'
         and membership.next_contact_at is null
       )
       or (
         p_filter = 'eligible'
         and (
           membership.next_contact_at is null
           or membership.next_contact_at <= v_now
         )
       )
     )
   order by
     case
       when membership.next_contact_at is not null
        and membership.next_contact_at < v_now then 0
       when membership.next_contact_at is not null
        and membership.next_contact_at >=
          pg_catalog.date_trunc('day', v_now at time zone 'Asia/Tokyo')
            at time zone 'Asia/Tokyo'
        and membership.next_contact_at <
          (pg_catalog.date_trunc('day', v_now at time zone 'Asia/Tokyo')
            + interval '1 day') at time zone 'Asia/Tokyo' then 1
       when membership.stage in ('new', 'assigned') then 2
       when membership.stage = 'working' then 3
       else 4
     end,
     membership.priority nulls last,
     membership.next_contact_at nulls last,
     membership.updated_at asc,
     membership.created_at asc
   limit 1
   for update of membership skip locked;

  if not found then
    return;
  end if;

  update public.prospect_list_memberships membership
     set claimed_by = p_user_id,
         claimed_at = v_now,
         claim_expires_at = v_now
           + pg_catalog.make_interval(secs => greatest(p_lease_seconds, 60)),
         updated_at = v_now
   where membership.id = j.id
   returning membership.* into j;

  return next j;
end;
$$;

-- 既存架電RPCは旧migrationでauthenticatedの明示REVOKEがなく、実DB ACLを閉じ切れていない。
revoke all on function public.claim_next_prospect_call(uuid, uuid, int, text)
  from public, anon, authenticated;
grant execute on function public.claim_next_prospect_call(uuid, uuid, int, text)
  to service_role;

revoke all on function public.release_prospect_call_claim(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_prospect_call_claim(uuid, uuid)
  to service_role;
