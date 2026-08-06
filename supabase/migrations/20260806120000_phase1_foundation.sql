-- ============================================================
-- Phase 1 Supabase foundation
-- Design: docs/supabase-schema.md / docs/sync-design.md / docs/architecture.md
-- Do not break auth migrations (20260805000001 / 20260806000001)
-- ============================================================

-- ---- extensions ----
-- Hosted Supabase may require enabling extensions in Dashboard > Database > Extensions
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net extension not available in this environment: %', sqlerrm;
end $$;
do $$ begin
  create extension if not exists pg_cron with schema pg_catalog;
exception when others then
  raise notice 'pg_cron extension not available in this environment: %', sqlerrm;
end $$;

-- ---- enums (do not recreate app_role / provisioning_status / invitation_status) ----
do $$ begin
  create type public.sync_status as enum (
    'synced', 'pending', 'error', 'delete_pending', 'excluded'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.job_status as enum (
    'queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.write_op_status as enum (
    'pending', 'notion_done', 'completed', 'failed'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.import_row_status as enum (
    'pending', 'valid_new', 'valid_update', 'duplicate', 'invalid',
    'skipped', 'importing', 'imported', 'import_failed'
  );
exception when duplicate_object then null;
end $$;

-- ---- shared: updated_at ----
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end $$;

-- ============================================================
-- 
-- ============================================================

create table if not exists public.customer_index (
  notion_page_id text primary key,
  external_id uuid unique,
  content_hash text,
  notion_last_edited_at timestamptz,
  sync_status public.sync_status not null default 'pending',
  sync_error_message text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  display_name text not null default '',
  legal_name text,
  office_name text,
  postal_code text,
  prefecture text,
  city text,
  address_line text,
  phone_normalized text,
  email text,
  representative_name text,
  website text,
  business_category_ids text[] not null default '{}',
  tag_ids text[] not null default '{}',
  sales_status_id text,
  acquisition_route_id text,
  priority_id text,
  staff_user_ids uuid[] not null default '{}',
  latest_activity_summary text,
  last_activity_at timestamptz,
  next_action text,
  next_action_date date,
  expected_amount numeric,
  is_archived boolean not null default false,
  search_text text not null default '',
  search_text_kana text not null default ''
);

create index if not exists customer_index_search_text_trgm_idx
  on public.customer_index using gin (search_text gin_trgm_ops);
create index if not exists customer_index_search_text_kana_trgm_idx
  on public.customer_index using gin (search_text_kana gin_trgm_ops);
create index if not exists customer_index_phone_normalized_idx
  on public.customer_index (phone_normalized);
create index if not exists customer_index_prefecture_idx
  on public.customer_index (prefecture);
create index if not exists customer_index_sales_status_id_idx
  on public.customer_index (sales_status_id);
create index if not exists customer_index_next_action_date_idx
  on public.customer_index (next_action_date);
create index if not exists customer_index_last_activity_at_idx
  on public.customer_index (last_activity_at);
create index if not exists customer_index_tag_ids_idx
  on public.customer_index using gin (tag_ids);
create index if not exists customer_index_business_category_ids_idx
  on public.customer_index using gin (business_category_ids);
create index if not exists customer_index_staff_user_ids_idx
  on public.customer_index using gin (staff_user_ids);

create trigger customer_index_set_updated_at
  before update on public.customer_index
  for each row execute function public.set_updated_at();

create table if not exists public.customer_relations (
  from_page_id text not null,
  to_page_id text not null,
  primary key (from_page_id, to_page_id)
);

create table if not exists public.contact_index (
  notion_page_id text primary key,
  external_id uuid unique,
  content_hash text,
  notion_last_edited_at timestamptz,
  sync_status public.sync_status not null default 'pending',
  sync_error_message text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null default '',
  name_kana text,
  customer_page_id text,
  department text,
  title text,
  phone_normalized text,
  email text,
  contact_type_id text,
  note text,
  is_active boolean not null default true,
  search_text text not null default ''
);

create trigger contact_index_set_updated_at
  before update on public.contact_index
  for each row execute function public.set_updated_at();

create table if not exists public.deal_index (
  notion_page_id text primary key,
  external_id uuid unique,
  content_hash text,
  notion_last_edited_at timestamptz,
  sync_status public.sync_status not null default 'pending',
  sync_error_message text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null default '',
  customer_page_id text,
  business_category_id text,
  product_name text,
  stage_id text,
  status_id text,
  status_semantic text,
  staff_user_ids uuid[] not null default '{}',
  expected_amount numeric,
  contract_amount numeric,
  probability numeric,
  expected_close_date date,
  contracted_at date,
  period_start date,
  period_end date,
  next_action text,
  next_action_date date,
  lost_reason text,
  note text
);

create index if not exists deal_index_status_semantic_idx
  on public.deal_index (status_semantic);
create index if not exists deal_index_customer_page_id_idx
  on public.deal_index (customer_page_id);

create trigger deal_index_set_updated_at
  before update on public.deal_index
  for each row execute function public.set_updated_at();

create table if not exists public.activity_index (
  notion_page_id text primary key,
  external_id uuid unique,
  content_hash text,
  notion_last_edited_at timestamptz,
  sync_status public.sync_status not null default 'pending',
  sync_error_message text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null default '',
  summary text,
  body_hash text,
  customer_page_id text,
  deal_page_id text,
  activity_at timestamptz,
  category_ids text[] not null default '{}',
  created_by uuid,
  created_by_name text,
  updated_by uuid,
  updated_by_name text,
  batch_id text
);

create index if not exists activity_index_created_by_activity_at_idx
  on public.activity_index (created_by, activity_at);
create index if not exists activity_index_customer_page_id_idx
  on public.activity_index (customer_page_id);
create index if not exists activity_index_category_ids_idx
  on public.activity_index using gin (category_ids);

create trigger activity_index_set_updated_at
  before update on public.activity_index
  for each row execute function public.set_updated_at();

create table if not exists public.contract_index (
  notion_page_id text primary key,
  external_id uuid unique,
  content_hash text,
  notion_last_edited_at timestamptz,
  sync_status public.sync_status not null default 'pending',
  sync_error_message text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null default '',
  customer_page_id text,
  deal_page_id text,
  contract_type_id text,
  trade_type_id text,
  amount numeric,
  contracted_at date,
  start_date date,
  end_date date,
  auto_renew boolean not null default false,
  payment_status_id text,
  status_id text,
  status_semantic text,
  staff_user_ids uuid[] not null default '{}',
  has_contract_url boolean not null default false,
  has_contract_file boolean not null default false,
  note text
);

create trigger contract_index_set_updated_at
  before update on public.contract_index
  for each row execute function public.set_updated_at();

create table if not exists public.complaint_index (
  notion_page_id text primary key,
  external_id uuid unique,
  content_hash text,
  notion_last_edited_at timestamptz,
  sync_status public.sync_status not null default 'pending',
  sync_error_message text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null default '',
  summary text,
  body_hash text,
  customer_page_id text,
  deal_page_id text,
  occurred_on date,
  severity_id text,
  assignee_user_id uuid,
  due_date date,
  status_id text,
  status_semantic text,
  completed_on date,
  note text
);

create trigger complaint_index_set_updated_at
  before update on public.complaint_index
  for each row execute function public.set_updated_at();

create table if not exists public.action_index (
  notion_page_id text primary key,
  external_id uuid unique,
  content_hash text,
  notion_last_edited_at timestamptz,
  sync_status public.sync_status not null default 'pending',
  sync_error_message text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  customer_page_id text not null,
  deal_page_id text,
  activity_page_id text,
  assignee_user_id uuid,
  due_date date,
  status_id text,
  is_open boolean not null default true,
  priority_id text,
  completed_at timestamptz,
  created_by uuid,
  created_by_name text
);

create index if not exists action_index_assignee_due_open_idx
  on public.action_index (assignee_user_id, due_date) where is_open;
create index if not exists action_index_customer_open_idx
  on public.action_index (customer_page_id) where is_open;
create index if not exists action_index_due_open_idx
  on public.action_index (due_date) where is_open;

create trigger action_index_set_updated_at
  before update on public.action_index
  for each row execute function public.set_updated_at();

create table if not exists public.masters_cache (
  notion_page_id text primary key,
  external_id uuid unique,
  content_hash text,
  notion_last_edited_at timestamptz,
  sync_status public.sync_status not null default 'pending',
  sync_error_message text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  master_type text not null,
  name text not null,
  semantic_key text,
  semantic_tags text[] not null default '{}',
  sort_order numeric,
  color text,
  is_active boolean not null default true,
  applicable_category_ids text[] not null default '{}'
);

create unique index if not exists masters_cache_type_semantic_key_uniq
  on public.masters_cache (master_type, semantic_key)
  where semantic_key is not null;
create index if not exists masters_cache_semantic_tags_idx
  on public.masters_cache using gin (semantic_tags);
create index if not exists masters_cache_master_type_idx
  on public.masters_cache (master_type);

create trigger masters_cache_set_updated_at
  before update on public.masters_cache
  for each row execute function public.set_updated_at();

-- ============================================================
-- / /
-- ============================================================

create table if not exists public.write_operations (
  request_id uuid primary key,
  entity_type text not null,
  operation text not null,
  external_id uuid not null,
  input_hash text not null,
  status public.write_op_status not null default 'pending',
  notion_page_id text,
  recovery_payload jsonb,
  actor_id uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text
);

create index if not exists write_operations_external_id_idx
  on public.write_operations (external_id);
create index if not exists write_operations_status_started_idx
  on public.write_operations (status, started_at);

create table if not exists public.audit_logs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  actor_id uuid,
  actor_name text,
  action text not null,
  entity_type text,
  notion_page_id text,
  changed_fields jsonb,
  operation_source text,
  request_id uuid,
  batch_id text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_id_idx
  on public.audit_logs (actor_id);
create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, notion_page_id);

create or replace function public.forbid_audit_mutation() returns trigger
language plpgsql
security invoker set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only';
end $$;

drop trigger if exists audit_logs_no_update on public.audit_logs;
create trigger audit_logs_no_update
  before update on public.audit_logs
  for each row execute function public.forbid_audit_mutation();

drop trigger if exists audit_logs_no_delete on public.audit_logs;
create trigger audit_logs_no_delete
  before delete on public.audit_logs
  for each row execute function public.forbid_audit_mutation();

revoke update, delete on public.audit_logs from authenticated, anon;

create table if not exists public.jobs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  kind text not null,
  priority int not null default 100,
  status public.job_status not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  progress_done int not null default 0,
  progress_total int,
  cursor jsonb,
  idempotency_key text unique,
  locked_by text,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_run_at timestamptz not null default now(),
  error_message text,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists jobs_claim_idx
  on public.jobs (priority, created_at)
  where status in ('queued', 'running');
create index if not exists jobs_status_next_run_idx
  on public.jobs (status, next_run_at);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create table if not exists public.job_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  seq int not null,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error_message text,
  attempts int not null default 0,
  idempotency_key text,
  unique (job_id, seq),
  unique (job_id, idempotency_key)
);

create table if not exists public.sync_errors (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  stage text not null,
  entity_type text,
  notion_page_id text,
  external_id uuid,
  message text not null,
  detail jsonb,
  resolved_at timestamptz,
  ignored_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sync_errors_unresolved_idx
  on public.sync_errors (created_at desc)
  where resolved_at is null and ignored_at is null;

create table if not exists public.webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  job_id uuid references public.jobs (id)
);

-- ============================================================
-- CSV / / /
-- ============================================================

create table if not exists public.import_jobs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  job_id uuid references public.jobs (id),
  file_name text,
  storage_path text not null,
  file_size bigint,
  sha256 text,
  expires_at timestamptz not null,
  deleted_at timestamptz,
  encoding text,
  row_count int,
  column_mapping jsonb,
  status text not null default 'pending',
  summary jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger import_jobs_set_updated_at
  before update on public.import_jobs
  for each row execute function public.set_updated_at();

create table if not exists public.import_rows (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  import_job_id uuid not null references public.import_jobs (id) on delete cascade,
  row_number int not null,
  external_id uuid,
  status public.import_row_status not null default 'pending',
  raw jsonb,
  normalized jsonb,
  match_reason text,
  matched_page_id text,
  error_message text,
  unique (import_job_id, row_number)
);

create table if not exists public.saved_searches (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references public.app_users (id),
  name text not null,
  query jsonb not null,
  is_shared boolean not null default false,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger saved_searches_set_updated_at
  before update on public.saved_searches
  for each row execute function public.set_updated_at();

create table if not exists public.recent_views (
  user_id uuid not null references public.app_users (id) on delete cascade,
  customer_page_id text not null,
  viewed_at timestamptz not null default now(),
  primary key (user_id, customer_page_id)
);

create index if not exists recent_views_user_viewed_idx
  on public.recent_views (user_id, viewed_at desc);

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.notion_rate_limiter (
  id int primary key default 1 check (id = 1),
  next_slot_at timestamptz not null default now(),
  blocked_until timestamptz,
  min_interval_ms int not null default 350
);

insert into public.notion_rate_limiter (id)
values (1)
on conflict (id) do nothing;

-- ============================================================
-- RPC: jobs
-- ============================================================

create or replace function public.claim_next_job(
  p_worker_id text,
  p_lease_seconds int default 300
)
returns setof public.jobs
language plpgsql
security definer set search_path = ''
as $$
declare
  j public.jobs;
begin
  update public.jobs set
    status = 'failed',
    error_message = coalesce(error_message, 'lease expired; max_attempts exceeded'),
    finished_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where status = 'running'
    and lease_expires_at < pg_catalog.now()
    and attempts >= max_attempts;

  select * into j
  from public.jobs
  where attempts < max_attempts
    and (
      (status = 'queued' and next_run_at <= pg_catalog.now())
      or
      (status = 'running' and lease_expires_at < pg_catalog.now())
    )
  order by priority, created_at
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update public.jobs set
    status = 'running',
    locked_by = p_worker_id,
    locked_at = pg_catalog.now(),
    lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
    heartbeat_at = pg_catalog.now(),
    attempts = attempts + 1,
    started_at = coalesce(started_at, pg_catalog.now()),
    updated_at = pg_catalog.now()
  where id = j.id;

  return query select * from public.jobs where id = j.id;
end $$;

create or replace function public.heartbeat_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds int default 300
)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  updated_id uuid;
begin
  update public.jobs set
    heartbeat_at = pg_catalog.now(),
    lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
    updated_at = pg_catalog.now()
  where id = p_job_id
    and locked_by = p_worker_id
    and status = 'running'
    and lease_expires_at > pg_catalog.now()
  returning id into updated_id;

  return updated_id is not null;
end $$;

create or replace function public.complete_job(
  p_job_id uuid,
  p_worker_id text,
  p_result jsonb default null
)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  updated_id uuid;
begin
  update public.jobs set
    status = 'succeeded',
    payload = case
      when p_result is null then payload
      else payload || pg_catalog.jsonb_build_object('result', p_result)
    end,
    finished_at = pg_catalog.now(),
    error_message = null,
    updated_at = pg_catalog.now()
  where id = p_job_id
    and locked_by = p_worker_id
    and status = 'running'
    and lease_expires_at > pg_catalog.now()
  returning id into updated_id;

  return updated_id is not null;
end $$;

create or replace function public.fail_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_message text default null,
  p_backoff_seconds int default 60
)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  j public.jobs;
  updated_id uuid;
begin
  select * into j
  from public.jobs
  where id = p_job_id
    and locked_by = p_worker_id
    and status = 'running'
    and lease_expires_at > pg_catalog.now()
  for update;

  if not found then
    return false;
  end if;

  if j.attempts < j.max_attempts then
    update public.jobs set
      status = 'queued',
      locked_by = null,
      locked_at = null,
      lease_expires_at = null,
      heartbeat_at = null,
      next_run_at = pg_catalog.now()
        + pg_catalog.make_interval(secs => greatest(p_backoff_seconds, 1)),
      error_message = coalesce(p_error_message, error_message),
      updated_at = pg_catalog.now()
    where id = j.id
    returning id into updated_id;
  else
    update public.jobs set
      status = 'failed',
      finished_at = pg_catalog.now(),
      error_message = coalesce(p_error_message, error_message, 'max_attempts exceeded'),
      updated_at = pg_catalog.now()
    where id = j.id
    returning id into updated_id;
  end if;

  return updated_id is not null;
end $$;

create or replace function public.ingest_webhook_event(
  p_event_id text,
  p_event_type text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_job_id uuid;
  v_existing uuid;
begin
  select job_id into v_existing
  from public.webhook_events
  where event_id = p_event_id;

  if found then
    return v_existing;
  end if;

  insert into public.jobs (kind, priority, payload, idempotency_key)
  values (
    'webhook_sync',
    50,
    pg_catalog.jsonb_build_object(
      'event_id', p_event_id,
      'event_type', p_event_type
    ),
    'webhook:' || p_event_id
  )
  returning id into v_job_id;

  insert into public.webhook_events (event_id, event_type, payload, job_id)
  values (p_event_id, p_event_type, p_payload, v_job_id);

  return v_job_id;
exception
  when unique_violation then
    select job_id into v_existing
    from public.webhook_events
    where event_id = p_event_id;
    return v_existing;
end $$;

-- ============================================================
-- RPC: notion rate limiter
-- ============================================================

create or replace function public.reserve_notion_slot(
  p_priority text default 'bulk'
)
returns timestamptz
language plpgsql
security definer set search_path = ''
as $$
declare
  slot timestamptz;
begin
  update public.notion_rate_limiter set
    next_slot_at = greatest(
      pg_catalog.now(),
      next_slot_at,
      coalesce(blocked_until, pg_catalog.now())
    ) + pg_catalog.make_interval(
      secs => min_interval_ms / 1000.0
        * case when p_priority = 'interactive' then 1 else 2 end
    )
  where id = 1
  returning next_slot_at into slot;

  return slot;
end $$;

create or replace function public.report_notion_rate_limited(
  p_retry_after_seconds int
)
returns void
language sql
security definer set search_path = ''
as $$
  update public.notion_rate_limiter
    set blocked_until = greatest(
      coalesce(blocked_until, pg_catalog.now()),
      pg_catalog.now() + pg_catalog.make_interval(secs => p_retry_after_seconds)
    )
  where id = 1;
$$;

create or replace function public.get_notion_rate_limiter_state()
returns table (
  next_slot_at timestamptz,
  blocked_until timestamptz,
  min_interval_ms int
)
language sql
stable
security definer set search_path = ''
as $$
  select r.next_slot_at, r.blocked_until, r.min_interval_ms
  from public.notion_rate_limiter r
  where r.id = 1;
$$;

-- ============================================================
-- RPC
-- ============================================================

revoke execute on function public.claim_next_job(text, int) from public, anon, authenticated;
grant  execute on function public.claim_next_job(text, int) to service_role;

revoke execute on function public.heartbeat_job(uuid, text, int) from public, anon, authenticated;
grant  execute on function public.heartbeat_job(uuid, text, int) to service_role;

revoke execute on function public.complete_job(uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function public.complete_job(uuid, text, jsonb) to service_role;

revoke execute on function public.fail_job(uuid, text, text, int) from public, anon, authenticated;
grant  execute on function public.fail_job(uuid, text, text, int) to service_role;

revoke execute on function public.ingest_webhook_event(text, text, jsonb) from public, anon, authenticated;
grant  execute on function public.ingest_webhook_event(text, text, jsonb) to service_role;

revoke execute on function public.reserve_notion_slot(text) from public, anon, authenticated;
grant  execute on function public.reserve_notion_slot(text) to service_role;

revoke execute on function public.report_notion_rate_limited(int) from public, anon, authenticated;
grant  execute on function public.report_notion_rate_limited(int) to service_role;

revoke execute on function public.get_notion_rate_limiter_state() from public, anon, authenticated;
grant  execute on function public.get_notion_rate_limiter_state() to service_role;

-- current_app_role is defined by auth foundation; re-assert grants
revoke execute on function public.current_app_role() from public, anon;
grant  execute on function public.current_app_role() to authenticated, service_role;

-- ============================================================
-- RLS
-- ============================================================

alter table public.customer_index enable row level security;
alter table public.customer_relations enable row level security;
alter table public.contact_index enable row level security;
alter table public.deal_index enable row level security;
alter table public.activity_index enable row level security;
alter table public.contract_index enable row level security;
alter table public.complaint_index enable row level security;
alter table public.action_index enable row level security;
alter table public.masters_cache enable row level security;
alter table public.write_operations enable row level security;
alter table public.audit_logs enable row level security;
alter table public.jobs enable row level security;
alter table public.job_items enable row level security;
alter table public.sync_errors enable row level security;
alter table public.webhook_events enable row level security;
alter table public.import_jobs enable row level security;
alter table public.import_rows enable row level security;
alter table public.saved_searches enable row level security;
alter table public.recent_views enable row level security;
alter table public.system_settings enable row level security;
alter table public.notion_rate_limiter enable row level security;

-- :
do $$
declare
  t text;
begin
  foreach t in array array[
    'customer_index', 'customer_relations', 'contact_index', 'deal_index',
    'activity_index', 'contract_index', 'complaint_index', 'action_index',
    'masters_cache'
  ]
  loop
    execute format(
      'drop policy if exists %I on public.%I;
       create policy %I on public.%I
         for select to authenticated
         using (public.current_app_role() is not null);',
      t || '_select', t, t || '_select', t
    );
  end loop;
end $$;

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (public.current_app_role() in ('admin', 'a'));

drop policy if exists write_operations_select on public.write_operations;
create policy write_operations_select on public.write_operations
  for select to authenticated
  using (public.current_app_role() = 'admin');

drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
  for select to authenticated
  using (
    public.current_app_role() = 'admin'
    or (
      public.current_app_role() in ('admin', 'a')
      and created_by = auth.uid()
      and kind in ('csv_import', 'export_full')
    )
  );

drop policy if exists job_items_select on public.job_items;
create policy job_items_select on public.job_items
  for select to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_id
        and (
          public.current_app_role() = 'admin'
          or (
            public.current_app_role() in ('admin', 'a')
            and j.created_by = auth.uid()
          )
        )
    )
  );

drop policy if exists sync_errors_select on public.sync_errors;
create policy sync_errors_select on public.sync_errors
  for select to authenticated
  using (public.current_app_role() = 'admin');

drop policy if exists webhook_events_select on public.webhook_events;
create policy webhook_events_select on public.webhook_events
  for select to authenticated
  using (public.current_app_role() = 'admin');

drop policy if exists notion_rate_limiter_select on public.notion_rate_limiter;
create policy notion_rate_limiter_select on public.notion_rate_limiter
  for select to authenticated
  using (public.current_app_role() = 'admin');

drop policy if exists import_jobs_select on public.import_jobs;
create policy import_jobs_select on public.import_jobs
  for select to authenticated
  using (
    public.current_app_role() = 'admin'
    or (
      public.current_app_role() = 'a'
      and created_by = auth.uid()
    )
  );

drop policy if exists import_rows_select on public.import_rows;
create policy import_rows_select on public.import_rows
  for select to authenticated
  using (
    exists (
      select 1 from public.import_jobs ij
      where ij.id = import_job_id
        and (
          public.current_app_role() = 'admin'
          or (
            public.current_app_role() = 'a'
            and ij.created_by = auth.uid()
          )
        )
    )
  );

drop policy if exists saved_searches_select on public.saved_searches;
create policy saved_searches_select on public.saved_searches
  for select to authenticated
  using (
    owner_id = auth.uid()
    or (is_shared and public.current_app_role() is not null)
  );

drop policy if exists saved_searches_insert on public.saved_searches;
create policy saved_searches_insert on public.saved_searches
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and public.current_app_role() is not null
  );

drop policy if exists saved_searches_update on public.saved_searches;
create policy saved_searches_update on public.saved_searches
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists saved_searches_delete on public.saved_searches;
create policy saved_searches_delete on public.saved_searches
  for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists recent_views_select on public.recent_views;
create policy recent_views_select on public.recent_views
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists recent_views_insert on public.recent_views;
create policy recent_views_insert on public.recent_views
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists recent_views_update on public.recent_views;
create policy recent_views_update on public.recent_views
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists recent_views_delete on public.recent_views;
create policy recent_views_delete on public.recent_views
  for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists system_settings_select on public.system_settings;
create policy system_settings_select on public.system_settings
  for select to authenticated
  using (public.current_app_role() = 'admin');
