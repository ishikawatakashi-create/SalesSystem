-- Phase 13B: 架電管理 / claim / 昇格 / formal match keys
-- Prospect operational data は Notion 非書込。昇格時のみ既存 write pipeline。

-- ============================================================
-- customer_index: normalized_domain (derived matching key)
-- ============================================================

alter table public.customer_index
  add column if not exists normalized_domain text;

create index if not exists customer_index_normalized_domain_idx
  on public.customer_index (normalized_domain)
  where normalized_domain is not null and is_archived = false;

comment on column public.customer_index.normalized_domain is
  'Derived from website (and optionally email host). Matching index only; Notion remains SSoT.';

-- ============================================================
-- membership stage: add converted
-- ============================================================

alter table public.prospect_list_memberships
  drop constraint if exists prospect_list_memberships_stage_check;

alter table public.prospect_list_memberships
  add constraint prospect_list_memberships_stage_check
  check (stage in (
    'new', 'assigned', 'working', 'qualified', 'disqualified', 'converted'
  ));

alter table public.prospect_list_memberships
  add column if not exists next_contact_at timestamptz,
  add column if not exists last_contact_at timestamptz,
  add column if not exists last_call_result text,
  add column if not exists call_count int not null default 0,
  add column if not exists claimed_by uuid references public.app_users (id) on delete set null,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz;

create index if not exists prospect_list_memberships_next_contact_idx
  on public.prospect_list_memberships (assigned_user_id, next_contact_at)
  where archived_at is null and assigned_user_id is not null;

create index if not exists prospect_list_memberships_claim_idx
  on public.prospect_list_memberships (claim_expires_at)
  where claimed_by is not null and archived_at is null;

-- ============================================================
-- prospects: promotion fields
-- ============================================================

alter table public.prospects
  add column if not exists promotion_status text not null default 'none'
    check (promotion_status in (
      'none', 'pending', 'organization_created', 'contacts_done',
      'activity_done', 'action_done', 'completed', 'failed'
    )),
  add column if not exists promoted_customer_page_id text,
  add column if not exists promoted_customer_external_id text,
  add column if not exists promoted_at timestamptz,
  add column if not exists promoted_by uuid references public.app_users (id) on delete set null,
  add column if not exists promotion_error text,
  add column if not exists promotion_request_id text,
  add column if not exists phone_invalid boolean not null default false;

create unique index if not exists prospects_promotion_request_id_unique
  on public.prospects (promotion_request_id)
  where promotion_request_id is not null;

create index if not exists prospects_promoted_page_idx
  on public.prospects (promoted_customer_page_id)
  where promoted_customer_page_id is not null;

-- ============================================================
-- prospect_call_attempts
-- ============================================================

create table if not exists public.prospect_call_attempts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  membership_id uuid references public.prospect_list_memberships (id) on delete set null,
  contact_id uuid references public.prospect_contacts (id) on delete set null,
  performed_by uuid not null references public.app_users (id) on delete restrict,
  result text not null
    check (result in (
      'no_answer', 'busy', 'gatekeeper', 'contact_absent', 'callback_requested',
      'connected', 'send_materials', 'interested', 'appointment',
      'not_interested', 'wrong_number', 'do_not_contact', 'other'
    )),
  note text,
  started_at timestamptz,
  completed_at timestamptz not null default now(),
  next_contact_at timestamptz,
  clear_next_contact boolean not null default false,
  phone_used text,
  phone_normalized text,
  source text not null default 'manual_call',
  request_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint prospect_call_attempts_request_id_unique unique (request_id)
);

create index if not exists prospect_call_attempts_prospect_idx
  on public.prospect_call_attempts (prospect_id, completed_at desc)
  where archived_at is null;
create index if not exists prospect_call_attempts_membership_idx
  on public.prospect_call_attempts (membership_id, completed_at desc)
  where archived_at is null;
create index if not exists prospect_call_attempts_performed_idx
  on public.prospect_call_attempts (performed_by, completed_at desc)
  where archived_at is null;
create index if not exists prospect_call_attempts_result_idx
  on public.prospect_call_attempts (result)
  where archived_at is null;

comment on table public.prospect_call_attempts is
  'Phase 13B operational call history. Not Notion Activity until promotion copies selected rows.';

drop trigger if exists prospect_call_attempts_set_updated_at on public.prospect_call_attempts;
create trigger prospect_call_attempts_set_updated_at
  before update on public.prospect_call_attempts
  for each row execute function public.set_updated_at();

alter table public.prospect_call_attempts enable row level security;

drop policy if exists prospect_call_attempts_select on public.prospect_call_attempts;
create policy prospect_call_attempts_select on public.prospect_call_attempts
  for select to authenticated
  using (public.current_app_role() is not null);

revoke all on table public.prospect_call_attempts from anon;
grant select on table public.prospect_call_attempts to authenticated;
grant all on table public.prospect_call_attempts to service_role;

-- ============================================================
-- claim_next_prospect_call RPC
-- ============================================================

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

  -- expire stale claims (any user)
  update public.prospect_list_memberships
  set
    claimed_by = null,
    claimed_at = null,
    claim_expires_at = null,
    updated_at = v_now
  where claimed_by is not null
    and claim_expires_at is not null
    and claim_expires_at < v_now
    and archived_at is null;

  select m.* into j
  from public.prospect_list_memberships m
  join public.prospects p on p.id = m.prospect_id
  where m.archived_at is null
    and p.archived_at is null
    and p.do_not_contact = false
    and coalesce(p.promotion_status, 'none') not in ('completed', 'pending', 'organization_created', 'contacts_done', 'activity_done', 'action_done')
    and m.assigned_user_id = p_user_id
    and m.stage in ('new', 'assigned', 'working')
    and (p_list_id is null or m.prospect_list_id = p_list_id)
    and (
      m.claimed_by is null
      or m.claimed_by = p_user_id
      or m.claim_expires_at is null
      or m.claim_expires_at < v_now
    )
    and (
      p_filter = 'all'
      or (
        p_filter = 'overdue'
        and m.next_contact_at is not null
        and m.next_contact_at < date_trunc('day', v_now at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'
      )
      or (
        p_filter = 'today'
        and m.next_contact_at is not null
        and m.next_contact_at >= date_trunc('day', v_now at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'
        and m.next_contact_at < (date_trunc('day', v_now at time zone 'Asia/Tokyo') + interval '1 day') at time zone 'Asia/Tokyo'
      )
      or (
        p_filter = 'no_schedule'
        and m.next_contact_at is null
      )
      or (
        p_filter = 'eligible'
        and (
          m.next_contact_at is null
          or m.next_contact_at <= v_now
        )
      )
    )
  order by
    case
      when m.next_contact_at is not null and m.next_contact_at < v_now then 0
      when m.next_contact_at is not null
        and m.next_contact_at >= date_trunc('day', v_now at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'
        and m.next_contact_at < (date_trunc('day', v_now at time zone 'Asia/Tokyo') + interval '1 day') at time zone 'Asia/Tokyo'
        then 1
      when m.stage in ('new', 'assigned') then 2
      when m.stage = 'working' then 3
      else 4
    end,
    m.priority nulls last,
    m.next_contact_at nulls last,
    m.updated_at asc,
    m.created_at asc
  limit 1
  for update of m skip locked;

  if not found then
    return;
  end if;

  update public.prospect_list_memberships
  set
    claimed_by = p_user_id,
    claimed_at = v_now,
    claim_expires_at = v_now + make_interval(secs => greatest(p_lease_seconds, 60)),
    updated_at = v_now
  where id = j.id
  returning * into j;

  return next j;
end;
$$;

revoke all on function public.claim_next_prospect_call(uuid, uuid, int, text) from public, anon;
grant execute on function public.claim_next_prospect_call(uuid, uuid, int, text) to service_role;

create or replace function public.release_prospect_call_claim(
  p_membership_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.prospect_list_memberships
  set
    claimed_by = null,
    claimed_at = null,
    claim_expires_at = null,
    updated_at = now()
  where id = p_membership_id
    and archived_at is null
    and (claimed_by = p_user_id or claimed_by is null);
  return found;
end;
$$;

revoke all on function public.release_prospect_call_claim(uuid, uuid) from public, anon;
grant execute on function public.release_prospect_call_claim(uuid, uuid) to service_role;

-- ============================================================
-- list call KPI helper
-- ============================================================

create or replace function public.prospect_list_call_stats(
  p_list_ids uuid[],
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  prospect_list_id uuid,
  attempt_count bigint,
  attempted_prospect_count bigint,
  connected_prospect_count bigint,
  interested_prospect_count bigint,
  appointment_prospect_count bigint,
  disqualified_prospect_count bigint,
  dnc_prospect_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with attempts as (
    select
      m.prospect_list_id,
      a.prospect_id,
      a.result
    from public.prospect_call_attempts a
    join public.prospect_list_memberships m on m.id = a.membership_id
    where m.prospect_list_id = any (p_list_ids)
      and a.archived_at is null
      and (p_from is null or a.completed_at >= p_from)
      and (p_to is null or a.completed_at < p_to)
  )
  select
    m.prospect_list_id,
    (select count(*) from attempts x where x.prospect_list_id = m.prospect_list_id)::bigint,
    (
      select count(distinct prospect_id) from attempts x
      where x.prospect_list_id = m.prospect_list_id
    )::bigint,
    (
      select count(distinct prospect_id) from attempts x
      where x.prospect_list_id = m.prospect_list_id
        and x.result in (
          'connected', 'send_materials', 'interested', 'appointment',
          'not_interested', 'do_not_contact'
        )
    )::bigint,
    (
      select count(distinct prospect_id) from attempts x
      where x.prospect_list_id = m.prospect_list_id
        and x.result = 'interested'
    )::bigint,
    (
      select count(distinct prospect_id) from attempts x
      where x.prospect_list_id = m.prospect_list_id
        and x.result = 'appointment'
    )::bigint,
    (
      select count(*) from public.prospect_list_memberships mm
      where mm.prospect_list_id = m.prospect_list_id
        and mm.archived_at is null
        and mm.stage = 'disqualified'
    )::bigint,
    (
      select count(*) from public.prospect_list_memberships mm
      join public.prospects pp on pp.id = mm.prospect_id
      where mm.prospect_list_id = m.prospect_list_id
        and mm.archived_at is null
        and pp.do_not_contact = true
    )::bigint
  from (select distinct unnest(p_list_ids) as prospect_list_id) m;
$$;

revoke all on function public.prospect_list_call_stats(uuid[], timestamptz, timestamptz) from public, anon;
grant execute on function public.prospect_list_call_stats(uuid[], timestamptz, timestamptz) to authenticated, service_role;
