-- Phase 11: お問い合わせ受信箱 + Gmail integration (operational data)
-- Notion 業務DBへお問い合わせDBは追加しない。

-- ============================================================
-- inquiries
-- ============================================================

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'strikingly_email',
  source_message_id text not null,
  source_thread_id text,
  received_at timestamptz not null,
  subject text,
  sender_name text,
  sender_email text,
  reply_to_email text,
  phone text,
  phone_normalized text,
  company_name text,
  form_name text,
  message_text text,
  form_fields jsonb not null default '{}'::jsonb,
  attachment_meta jsonb not null default '[]'::jsonb,
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'done', 'no_action')),
  assigned_user_id uuid references public.app_users (id) on delete set null,
  linked_customer_page_id text,
  linked_contact_page_id text,
  linked_activity_page_id text,
  handled_at timestamptz,
  no_action_reason text,
  parse_status text not null default 'ok'
    check (parse_status in ('ok', 'warning', 'failed')),
  parse_warning_code text,
  source_confidence text not null default 'medium'
    check (source_confidence in ('high', 'medium', 'low')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inquiries_source_message_id_unique unique (source_message_id)
);

create index if not exists inquiries_status_received_idx
  on public.inquiries (status, received_at desc);
create index if not exists inquiries_assigned_idx
  on public.inquiries (assigned_user_id)
  where assigned_user_id is not null;
create index if not exists inquiries_received_at_idx
  on public.inquiries (received_at desc);
create index if not exists inquiries_sender_email_idx
  on public.inquiries (sender_email)
  where sender_email is not null;

comment on table public.inquiries is
  'Phase 11 operational inbox. Not a Notion business DB.';

-- ============================================================
-- Gmail OAuth CSRF state (short-lived)
-- ============================================================

create table if not exists public.gmail_oauth_states (
  state text primary key,
  created_by uuid not null references public.app_users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists gmail_oauth_states_expires_idx
  on public.gmail_oauth_states (expires_at);

-- ============================================================
-- RLS
-- ============================================================

alter table public.inquiries enable row level security;
alter table public.gmail_oauth_states enable row level security;

-- inquiries: authenticated users with app role can SELECT (view).
-- Writes go through service_role / Server Actions (Secret key bypasses RLS).
drop policy if exists inquiries_select on public.inquiries;
create policy inquiries_select on public.inquiries
  for select
  to authenticated
  using (public.current_app_role() is not null);

-- oauth states: no direct client access
drop policy if exists gmail_oauth_states_deny on public.gmail_oauth_states;
create policy gmail_oauth_states_deny on public.gmail_oauth_states
  for all
  to authenticated
  using (false)
  with check (false);

revoke all on table public.inquiries from anon;
grant select on table public.inquiries to authenticated;
grant all on table public.inquiries to service_role;

revoke all on table public.gmail_oauth_states from anon, authenticated;
grant all on table public.gmail_oauth_states to service_role;

-- ============================================================
-- Vault: Gmail OAuth refresh token
-- ============================================================

create or replace function public.store_gmail_oauth_refresh_token(
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'gmail_oauth_refresh_token';
  v_existing uuid;
  v_now timestamptz := now();
begin
  if p_token is null or length(btrim(p_token)) < 8 then
    raise exception 'invalid_token';
  end if;

  select id into v_existing
  from vault.secrets
  where name = v_name
  limit 1;

  if v_existing is null then
    perform vault.create_secret(p_token, v_name, 'Gmail OAuth refresh token');
  else
    perform vault.update_secret(v_existing, p_token, v_name, 'Gmail OAuth refresh token');
  end if;

  insert into public.system_settings (key, value, updated_at)
  values (
    'gmail_integration',
    jsonb_build_object(
      'status', 'connected',
      'vault_secret_name', v_name,
      'connected_at', v_now
    ),
    v_now
  )
  on conflict (key) do update
    set value = public.system_settings.value
      || jsonb_build_object(
        'status', 'connected',
        'vault_secret_name', v_name,
        'connected_at', coalesce(
          public.system_settings.value->>'connected_at',
          v_now::text
        ),
        'needs_reconnect', false
      ),
        updated_at = v_now;

  return jsonb_build_object('status', 'connected');
end $$;

create or replace function public.read_gmail_oauth_refresh_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'gmail_oauth_refresh_token';
  v_token text;
begin
  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = v_name
  limit 1;
  return v_token;
end $$;

create or replace function public.clear_gmail_oauth_refresh_token()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'gmail_oauth_refresh_token';
  v_existing uuid;
  v_now timestamptz := now();
begin
  select id into v_existing
  from vault.secrets
  where name = v_name
  limit 1;

  if v_existing is not null then
    delete from vault.secrets where id = v_existing;
  end if;

  insert into public.system_settings (key, value, updated_at)
  values (
    'gmail_integration',
    jsonb_build_object(
      'status', 'disconnected',
      'ingestion_enabled', false,
      'cleared_at', v_now
    ),
    v_now
  )
  on conflict (key) do update
    set value = jsonb_build_object(
      'status', 'disconnected',
      'ingestion_enabled', false,
      'cleared_at', v_now
    ),
        updated_at = v_now;

  return jsonb_build_object('status', 'disconnected');
end $$;

revoke execute on function public.store_gmail_oauth_refresh_token(text) from public, anon, authenticated;
grant  execute on function public.store_gmail_oauth_refresh_token(text) to service_role;

revoke execute on function public.read_gmail_oauth_refresh_token() from public, anon, authenticated;
grant  execute on function public.read_gmail_oauth_refresh_token() to service_role;

revoke execute on function public.clear_gmail_oauth_refresh_token() from public, anon, authenticated;
grant  execute on function public.clear_gmail_oauth_refresh_token() to service_role;

-- ============================================================
-- Durable ingest for Gmail Pub/Sub → gmail_history_sync job
-- ============================================================

create or replace function public.ingest_gmail_pubsub_event(
  p_event_id text,
  p_email_address text,
  p_history_id text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_existing uuid;
begin
  if p_event_id is null or length(btrim(p_event_id)) = 0 then
    raise exception 'invalid_event_id';
  end if;

  select job_id into v_existing
  from public.webhook_events
  where event_id = p_event_id;

  if found then
    return v_existing;
  end if;

  insert into public.jobs (kind, priority, payload, idempotency_key)
  values (
    'gmail_history_sync',
    40,
    pg_catalog.jsonb_build_object(
      'event_id', p_event_id,
      'history_id', p_history_id,
      'email_address_present', (p_email_address is not null and length(btrim(p_email_address)) > 0)
    ),
    'gmail_pubsub:' || p_event_id
  )
  returning id into v_job_id;

  -- payload にメール本文・トークンを入れない（メタのみ）
  insert into public.webhook_events (event_id, event_type, payload, job_id)
  values (
    p_event_id,
    'gmail.pubsub',
    coalesce(p_payload, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'history_id', p_history_id,
        'has_email_address', (p_email_address is not null and length(btrim(p_email_address)) > 0)
      ),
    v_job_id
  );

  return v_job_id;
exception
  when unique_violation then
    select job_id into v_existing
    from public.webhook_events
    where event_id = p_event_id;
    return v_existing;
end $$;

revoke execute on function public.ingest_gmail_pubsub_event(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_gmail_pubsub_event(text, text, text, jsonb)
  to service_role;

-- seed settings meta (no secrets)
insert into public.system_settings (key, value, updated_at)
values (
  'gmail_integration',
  jsonb_build_object(
    'status', 'disconnected',
    'ingestion_enabled', false
  ),
  now()
)
on conflict (key) do nothing;
