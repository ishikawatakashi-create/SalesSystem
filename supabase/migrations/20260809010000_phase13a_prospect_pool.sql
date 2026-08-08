-- Phase 13A: Prospect Pool / 営業リスト基盤（Supabase operational data）
-- Notion へは書かない。正式組織昇格は Phase 13B。

-- ============================================================
-- prospect_lists
-- ============================================================

create table if not exists public.prospect_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'archived')),
  source_type text not null default 'csv'
    check (source_type in ('vendor', 'scraping', 'event', 'manual', 'csv', 'other')),
  source_name text,
  owner_user_id uuid references public.app_users (id) on delete set null,
  tags text[] not null default '{}',
  created_by uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists prospect_lists_status_idx
  on public.prospect_lists (status, updated_at desc);
create index if not exists prospect_lists_owner_idx
  on public.prospect_lists (owner_user_id)
  where owner_user_id is not null;

comment on table public.prospect_lists is
  'Phase 13A sales list / campaign. Operational; not Notion SSoT.';

-- ============================================================
-- prospects (canonical)
-- ============================================================

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  normalized_company_name text not null default '',
  website_url text,
  normalized_domain text,
  main_phone text,
  normalized_phone text,
  postal_code text,
  prefecture text,
  city text,
  address text,
  industry text,
  employee_range text,
  description text,
  notes text,
  do_not_contact boolean not null default false,
  do_not_contact_reason text,
  do_not_contact_at timestamptz,
  duplicate_review_status text not null default 'none'
    check (duplicate_review_status in (
      'none', 'probable', 'reviewed_keep', 'reviewed_merge'
    )),
  formal_org_match_page_id text,
  formal_org_match_external_id text,
  formal_org_match_confidence text
    check (
      formal_org_match_confidence is null
      or formal_org_match_confidence in ('high', 'probable')
    ),
  search_text text not null default '',
  created_by uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists prospects_normalized_domain_idx
  on public.prospects (normalized_domain)
  where normalized_domain is not null and archived_at is null;
create index if not exists prospects_normalized_phone_idx
  on public.prospects (normalized_phone)
  where normalized_phone is not null and archived_at is null;
create index if not exists prospects_normalized_company_name_idx
  on public.prospects (normalized_company_name)
  where archived_at is null;
create index if not exists prospects_dnc_idx
  on public.prospects (do_not_contact)
  where do_not_contact = true and archived_at is null;
create index if not exists prospects_formal_match_idx
  on public.prospects (formal_org_match_page_id)
  where formal_org_match_page_id is not null;
create index if not exists prospects_updated_idx
  on public.prospects (updated_at desc);
create index if not exists prospects_search_trgm_idx
  on public.prospects using gin (search_text gin_trgm_ops);

comment on table public.prospects is
  'Phase 13A canonical prospect org. Supabase SSoT until promoted (13B).';

-- ============================================================
-- prospect_contacts
-- ============================================================

create table if not exists public.prospect_contacts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  name text not null,
  normalized_name text not null default '',
  department text,
  title text,
  email text,
  normalized_email text,
  phone text,
  normalized_phone text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists prospect_contacts_prospect_idx
  on public.prospect_contacts (prospect_id)
  where archived_at is null;
create index if not exists prospect_contacts_normalized_email_idx
  on public.prospect_contacts (normalized_email)
  where normalized_email is not null and archived_at is null;
create index if not exists prospect_contacts_normalized_phone_idx
  on public.prospect_contacts (normalized_phone)
  where normalized_phone is not null and archived_at is null;

-- ============================================================
-- prospect_list_memberships
-- ============================================================

create table if not exists public.prospect_list_memberships (
  id uuid primary key default gen_random_uuid(),
  prospect_list_id uuid not null references public.prospect_lists (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  assigned_user_id uuid references public.app_users (id) on delete set null,
  stage text not null default 'new'
    check (stage in ('new', 'assigned', 'working', 'qualified', 'disqualified')),
  priority text,
  source_record_id text,
  source_row_hash text,
  source_attributes jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- Active membership uniqueness (list, prospect)
create unique index if not exists prospect_list_memberships_active_unique
  on public.prospect_list_memberships (prospect_list_id, prospect_id)
  where archived_at is null;

create unique index if not exists prospect_list_memberships_source_hash_unique
  on public.prospect_list_memberships (prospect_list_id, source_row_hash)
  where archived_at is null and source_row_hash is not null;

create index if not exists prospect_list_memberships_list_idx
  on public.prospect_list_memberships (prospect_list_id)
  where archived_at is null;
create index if not exists prospect_list_memberships_prospect_idx
  on public.prospect_list_memberships (prospect_id)
  where archived_at is null;
create index if not exists prospect_list_memberships_assigned_idx
  on public.prospect_list_memberships (assigned_user_id)
  where assigned_user_id is not null and archived_at is null;
create index if not exists prospect_list_memberships_stage_idx
  on public.prospect_list_memberships (prospect_list_id, stage)
  where archived_at is null;

comment on table public.prospect_list_memberships is
  'List-specific stage/assignment. Same prospect may belong to many lists.';

-- ============================================================
-- prospect_import_jobs / rows (Notion CSV と分離)
-- ============================================================

create table if not exists public.prospect_import_jobs (
  id uuid primary key default gen_random_uuid(),
  prospect_list_id uuid not null references public.prospect_lists (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  file_size bigint,
  file_sha256 text,
  encoding text,
  column_mapping jsonb not null default '{}'::jsonb,
  status text not null default 'uploaded'
    check (status in (
      'uploaded', 'mapped', 'validating', 'ready', 'importing',
      'completed', 'failed', 'cancelled'
    )),
  total_rows int not null default 0,
  accepted_count int not null default 0,
  reused_count int not null default 0,
  probable_duplicate_count int not null default 0,
  invalid_count int not null default 0,
  skipped_count int not null default 0,
  error_message text,
  expires_at timestamptz not null,
  created_by uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists prospect_import_jobs_list_idx
  on public.prospect_import_jobs (prospect_list_id, created_at desc);
create index if not exists prospect_import_jobs_status_idx
  on public.prospect_import_jobs (status);
create index if not exists prospect_import_jobs_expires_idx
  on public.prospect_import_jobs (expires_at);

create table if not exists public.prospect_import_rows (
  id uuid primary key default gen_random_uuid(),
  prospect_import_job_id uuid not null
    references public.prospect_import_jobs (id) on delete cascade,
  row_number int not null,
  raw jsonb not null default '{}'::jsonb,
  staged jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in (
      'pending', 'accepted', 'reused', 'probable_duplicate',
      'invalid', 'skipped', 'failed'
    )),
  source_record_id text,
  source_row_hash text,
  prospect_id uuid references public.prospects (id) on delete set null,
  membership_id uuid references public.prospect_list_memberships (id) on delete set null,
  match_reason text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (prospect_import_job_id, row_number)
);

create index if not exists prospect_import_rows_job_status_idx
  on public.prospect_import_rows (prospect_import_job_id, status);
create index if not exists prospect_import_rows_hash_idx
  on public.prospect_import_rows (prospect_import_job_id, source_row_hash)
  where source_row_hash is not null;

-- ============================================================
-- Aggregate helper for list KPI (single query, no N+1)
-- ============================================================

create or replace function public.prospect_list_stats(p_list_ids uuid[])
returns table (
  prospect_list_id uuid,
  total_count bigint,
  unassigned_count bigint,
  assigned_count bigint,
  working_count bigint,
  qualified_count bigint,
  disqualified_count bigint,
  dnc_count bigint,
  duplicate_review_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.prospect_list_id,
    count(*)::bigint as total_count,
    count(*) filter (where m.assigned_user_id is null)::bigint as unassigned_count,
    count(*) filter (where m.assigned_user_id is not null)::bigint as assigned_count,
    count(*) filter (where m.stage = 'working')::bigint as working_count,
    count(*) filter (where m.stage = 'qualified')::bigint as qualified_count,
    count(*) filter (where m.stage = 'disqualified')::bigint as disqualified_count,
    count(*) filter (where p.do_not_contact)::bigint as dnc_count,
    count(*) filter (
      where p.duplicate_review_status = 'probable'
    )::bigint as duplicate_review_count
  from public.prospect_list_memberships m
  join public.prospects p on p.id = m.prospect_id
  where m.prospect_list_id = any (p_list_ids)
    and m.archived_at is null
    and p.archived_at is null
  group by m.prospect_list_id;
$$;

revoke all on function public.prospect_list_stats(uuid[]) from public, anon;
grant execute on function public.prospect_list_stats(uuid[]) to authenticated, service_role;

-- ============================================================
-- updated_at triggers
-- ============================================================

drop trigger if exists prospect_lists_set_updated_at on public.prospect_lists;
create trigger prospect_lists_set_updated_at
  before update on public.prospect_lists
  for each row execute function public.set_updated_at();

drop trigger if exists prospects_set_updated_at on public.prospects;
create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();

drop trigger if exists prospect_contacts_set_updated_at on public.prospect_contacts;
create trigger prospect_contacts_set_updated_at
  before update on public.prospect_contacts
  for each row execute function public.set_updated_at();

drop trigger if exists prospect_list_memberships_set_updated_at
  on public.prospect_list_memberships;
create trigger prospect_list_memberships_set_updated_at
  before update on public.prospect_list_memberships
  for each row execute function public.set_updated_at();

drop trigger if exists prospect_import_jobs_set_updated_at on public.prospect_import_jobs;
create trigger prospect_import_jobs_set_updated_at
  before update on public.prospect_import_jobs
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================

alter table public.prospect_lists enable row level security;
alter table public.prospects enable row level security;
alter table public.prospect_contacts enable row level security;
alter table public.prospect_list_memberships enable row level security;
alter table public.prospect_import_jobs enable row level security;
alter table public.prospect_import_rows enable row level security;

drop policy if exists prospect_lists_select on public.prospect_lists;
create policy prospect_lists_select on public.prospect_lists
  for select to authenticated
  using (public.current_app_role() is not null);

drop policy if exists prospects_select on public.prospects;
create policy prospects_select on public.prospects
  for select to authenticated
  using (public.current_app_role() is not null);

drop policy if exists prospect_contacts_select on public.prospect_contacts;
create policy prospect_contacts_select on public.prospect_contacts
  for select to authenticated
  using (public.current_app_role() is not null);

drop policy if exists prospect_list_memberships_select on public.prospect_list_memberships;
create policy prospect_list_memberships_select on public.prospect_list_memberships
  for select to authenticated
  using (public.current_app_role() is not null);

drop policy if exists prospect_import_jobs_select on public.prospect_import_jobs;
create policy prospect_import_jobs_select on public.prospect_import_jobs
  for select to authenticated
  using (
    public.current_app_role() = 'admin'
    or created_by = auth.uid()
  );

drop policy if exists prospect_import_rows_select on public.prospect_import_rows;
create policy prospect_import_rows_select on public.prospect_import_rows
  for select to authenticated
  using (
    exists (
      select 1 from public.prospect_import_jobs j
      where j.id = prospect_import_job_id
        and (
          public.current_app_role() = 'admin'
          or j.created_by = auth.uid()
        )
    )
  );

revoke all on table public.prospect_lists from anon;
revoke all on table public.prospects from anon;
revoke all on table public.prospect_contacts from anon;
revoke all on table public.prospect_list_memberships from anon;
revoke all on table public.prospect_import_jobs from anon;
revoke all on table public.prospect_import_rows from anon;

grant select on table public.prospect_lists to authenticated;
grant select on table public.prospects to authenticated;
grant select on table public.prospect_contacts to authenticated;
grant select on table public.prospect_list_memberships to authenticated;
grant select on table public.prospect_import_jobs to authenticated;
grant select on table public.prospect_import_rows to authenticated;

grant all on table public.prospect_lists to service_role;
grant all on table public.prospects to service_role;
grant all on table public.prospect_contacts to service_role;
grant all on table public.prospect_list_memberships to service_role;
grant all on table public.prospect_import_jobs to service_role;
grant all on table public.prospect_import_rows to service_role;
