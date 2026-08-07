-- ============================================================
-- Phase 8: CSV Import Enhancement
-- Design: docs/csv-import-design.md
-- ADDITIVE only: new columns, indexes, storage bucket, RLS
-- ============================================================

set search_path = public, pg_catalog;

-- ---- import_jobs: new columns ----
-- Add columns if they don't exist (idempotent)

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_jobs'
      and column_name = 'entity_type'
  ) then
    alter table public.import_jobs add column entity_type text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_jobs'
      and column_name = 'import_mode'
  ) then
    alter table public.import_jobs add column import_mode text default 'create';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_jobs'
      and column_name = 'source_key_field'
  ) then
    alter table public.import_jobs add column source_key_field text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_jobs'
      and column_name = 'source_system'
  ) then
    alter table public.import_jobs add column source_system text default 'csv';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_jobs'
      and column_name = 'detected_encoding'
  ) then
    alter table public.import_jobs add column detected_encoding text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_jobs'
      and column_name = 'cancel_requested_at'
  ) then
    alter table public.import_jobs add column cancel_requested_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_jobs'
      and column_name = 'last_processed_at'
  ) then
    alter table public.import_jobs add column last_processed_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_jobs'
      and column_name = 'preview_summary'
  ) then
    alter table public.import_jobs add column preview_summary jsonb;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_jobs'
      and column_name = 'default_decision'
  ) then
    alter table public.import_jobs add column default_decision text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_jobs'
      and column_name = 'mapping_aliases'
  ) then
    alter table public.import_jobs add column mapping_aliases jsonb;
  end if;
end $$;

-- Document allowed status values (keep as text for app validation)
comment on column public.import_jobs.status is 
  'Allowed values (app-validated): pending, uploaded, analyzing, mapping_required, validating, validation_completed, ready, importing, partially_completed, completed, cancelled, failed';

comment on column public.import_jobs.import_mode is 
  'Import mode: create (insert only) | update (update only) | upsert (create or update)';

comment on column public.import_jobs.default_decision is 
  'Default decision for duplicate handling: create | update | skip';

comment on table public.import_jobs is 
  'CSV import jobs. WARNING: Never store webhook verification secrets or other sensitive credentials in this table.';

-- ---- import_rows: new columns ----

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_rows'
      and column_name = 'source_key'
  ) then
    alter table public.import_rows add column source_key text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_rows'
      and column_name = 'source_key_hash'
  ) then
    alter table public.import_rows add column source_key_hash text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_rows'
      and column_name = 'reason_codes'
  ) then
    alter table public.import_rows add column reason_codes jsonb default '[]';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_rows'
      and column_name = 'decision'
  ) then
    alter table public.import_rows add column decision text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_rows'
      and column_name = 'retry_count'
  ) then
    alter table public.import_rows add column retry_count int not null default 0;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_rows'
      and column_name = 'notion_page_id'
  ) then
    alter table public.import_rows add column notion_page_id text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'import_rows'
      and column_name = 'staged'
  ) then
    alter table public.import_rows add column staged jsonb;
  end if;
end $$;

comment on column public.import_rows.staged is 
  'Minimal mapped write payload ONLY. Do NOT store full CSV dump with PII.';

comment on column public.import_rows.raw is 
  'Legacy field. Prefer staged over raw to avoid bloating with PII. Leave nullable for backward compat.';

comment on column public.import_rows.decision is 
  'Row decision: create | update | skip | null';

comment on table public.import_rows is 
  'Import row records. WARNING: Do NOT log full CSV bodies, PII, or complete UUIDs. Store minimal mapped data only.';

-- ---- import_rows: new indexes ----

create index if not exists import_rows_import_job_id_status_idx
  on public.import_rows (import_job_id, status);

create index if not exists import_rows_import_job_id_source_key_hash_idx
  on public.import_rows (import_job_id, source_key_hash)
  where source_key_hash is not null;

-- ---- Storage bucket: imports ----

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'imports',
  'imports',
  false,
  20971520, -- 20MB
  array['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = array['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'];

-- ---- RLS policies on storage.objects for bucket 'imports' ----
-- Design principle: NO public access. Browser upload uses signed URL (service role)
-- or authenticated INSERT to own folder {user_id}/{import_job_id}/{random}.csv

-- SELECT: admin or owner folder
drop policy if exists imports_select on storage.objects;
create policy imports_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'imports'
    and (
      public.current_app_role() = 'admin'
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- INSERT: own folder only
drop policy if exists imports_insert on storage.objects;
create policy imports_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'imports'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.current_app_role() is not null
  );

-- UPDATE: admin or owner
drop policy if exists imports_update on storage.objects;
create policy imports_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'imports'
    and (
      public.current_app_role() = 'admin'
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- DELETE: admin or owner
drop policy if exists imports_delete on storage.objects;
create policy imports_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'imports'
    and (
      public.current_app_role() = 'admin'
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- ============================================================
-- End of Phase 8 migration
-- ============================================================
