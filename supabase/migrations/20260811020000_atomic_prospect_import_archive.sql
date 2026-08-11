-- P1: serialize prospect CSV import writes with list archival.
--
-- The durable invariant is:
--   * ready/importing imports keep the list non-archivable;
--   * a chunk owns one active_queue_job_id and performs every business write,
--     row checkpoint, counter update, and next enqueue in this transaction;
--   * archive takes the same list row lock, so it can only commit before an
--     import starts or after the final atomic chunk has finished writing.

-- Freeze the legacy start order for the whole migration transaction before
-- installing any compatibility DDL: old code writes import first, then jobs.
-- The same import -> jobs table-lock order avoids a rollout deadlock and leaves
-- no gap in which mapped -> ready can become an unvalidated existing row.
lock table public.prospect_import_jobs in share row exclusive mode;
lock table public.jobs in share row exclusive mode;

create or replace function public.guard_atomic_prospect_import_enqueue()
returns trigger
language plpgsql
security invoker set search_path = ''
as $$
begin
  if new.kind = 'prospect_csv_import'
     and coalesce(
       pg_catalog.current_setting('app.atomic_prospect_import_enqueue', true),
       ''
     ) <> 'on' then
    raise exception using
      errcode = 'P0001',
      message = 'atomic_prospect_import_enqueue_required';
  end if;
  return new;
end $$;

drop trigger if exists jobs_guard_atomic_prospect_import_enqueue on public.jobs;
create trigger jobs_guard_atomic_prospect_import_enqueue
  before insert on public.jobs
  for each row execute function public.guard_atomic_prospect_import_enqueue();

-- Both write-conflicting locks are still held here. Fail the migration if an
-- old worker or import is live; after commit, the trigger rejects old enqueue.
do $$
begin
  if exists (
    select 1
    from public.prospect_import_jobs i
    where i.status in ('ready', 'importing')
  ) or exists (
    select 1
    from public.jobs j
    where j.kind = 'prospect_csv_import'
      and j.status in ('queued', 'running', 'paused')
  ) then
    raise exception using
      errcode = '55000',
      message = 'atomic prospect import migration requires zero active imports and live prospect import queue jobs';
  end if;
end $$;

alter table public.prospect_import_jobs
  add column if not exists active_queue_job_id uuid
    references public.jobs (id) on delete set null;

-- Existing active imports may predate active_queue_job_id, so validation is
-- deferred. PostgreSQL still enforces this for every new/updated row, which
-- makes an old app's separate mapped -> ready write fail closed after deploy.
alter table public.prospect_import_jobs
  add constraint prospect_import_jobs_active_queue_required
  check (
    status not in ('ready', 'importing')
    or active_queue_job_id is not null
  ) not valid;

create index if not exists prospect_import_jobs_active_list_idx
  on public.prospect_import_jobs (prospect_list_id, id)
  where status in ('ready', 'importing');

comment on column public.prospect_import_jobs.active_queue_job_id is
  'The only generic queue job allowed to process the next atomic import chunk.';

create or replace function public.guard_prospect_list_archive_during_import()
returns trigger
language plpgsql
security invoker set search_path = ''
as $$
begin
  if (
    (new.status = 'archived' or new.archived_at is not null)
    and not (old.status = 'archived' or old.archived_at is not null)
    and exists (
      select 1
      from public.prospect_import_jobs j
      where j.prospect_list_id = new.id
        and j.status in ('ready', 'importing')
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'prospect_list_import_in_progress';
  end if;
  return new;
end $$;

drop trigger if exists prospect_lists_guard_active_import on public.prospect_lists;
create trigger prospect_lists_guard_active_import
  before update of status, archived_at on public.prospect_lists
  for each row execute function public.guard_prospect_list_archive_during_import();

create or replace function public.start_prospect_import_job(
  p_import_job_id uuid,
  p_expected_list_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_column_mapping jsonb
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_list public.prospect_lists%rowtype;
  v_import public.prospect_import_jobs%rowtype;
  v_queue_id uuid;
  v_queue_kind text;
  v_queue_payload jsonb;
  v_idempotency_key text;
  v_total_rows int;
  v_invalid_count int;
begin
  -- Global lock order starts with the parent list, then the import job.
  select l.* into v_list
  from public.prospect_lists l
  where l.id = p_expected_list_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'list_unavailable');
  end if;

  select j.* into v_import
  from public.prospect_import_jobs j
  where j.id = p_import_job_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'import_not_found');
  end if;

  if v_import.prospect_list_id <> p_expected_list_id then
    if v_import.status in ('uploaded', 'mapped', 'validating') then
      update public.prospect_import_jobs
      set status = 'failed',
          error_message = '取込先の営業リストを確認できませんでした。画面を再読み込みして、CSVを選び直してください。',
          finished_at = pg_catalog.now()
      where id = p_import_job_id;
    end if;
    return pg_catalog.jsonb_build_object('outcome', 'list_mismatch');
  end if;

  if v_import.status = 'completed' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_completed',
      'totalRows', v_import.total_rows
    );
  end if;

  if v_import.status in ('ready', 'importing') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_started',
      'totalRows', v_import.total_rows,
      'queueJobId', v_import.active_queue_job_id
    );
  end if;

  if v_import.status in ('failed', 'cancelled') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'terminal',
      'status', v_import.status
    );
  end if;

  if v_list.status = 'archived' or v_list.archived_at is not null then
    update public.prospect_import_jobs
    set status = 'failed',
        error_message = '取込先の営業リストが見つからないか、アーカイブ済みのため、CSVを取り込めません。営業リスト一覧から取込先を選び直してください。',
        finished_at = pg_catalog.now()
    where id = p_import_job_id
      and status in ('uploaded', 'mapped', 'validating');

    return pg_catalog.jsonb_build_object('outcome', 'list_unavailable');
  end if;

  if v_import.status not in ('mapped', 'validating') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'invalid_state',
      'status', v_import.status
    );
  end if;

  select pg_catalog.count(*)::int,
         pg_catalog.count(*) filter (where r.status = 'invalid')::int
  into v_total_rows, v_invalid_count
  from public.prospect_import_rows r
  where r.prospect_import_job_id = p_import_job_id;

  v_idempotency_key := pg_catalog.format(
    'prospect_csv_import:%s:start',
    p_import_job_id
  );

  perform pg_catalog.set_config(
    'app.atomic_prospect_import_enqueue',
    'on',
    true
  );
  insert into public.jobs (
    kind,
    priority,
    payload,
    idempotency_key,
    created_by
  ) values (
    'prospect_csv_import',
    40,
    pg_catalog.jsonb_build_object(
      'importJobId', p_import_job_id,
      'listId', p_expected_list_id,
      'cursorRowNumber', 0,
      'actorId', p_actor_id,
      'actorName', p_actor_name
    ),
    v_idempotency_key,
    p_actor_id
  )
  on conflict (idempotency_key) do nothing
  returning id into v_queue_id;
  perform pg_catalog.set_config(
    'app.atomic_prospect_import_enqueue',
    'off',
    true
  );

  if v_queue_id is null then
    select j.id, j.kind, j.payload
    into v_queue_id, v_queue_kind, v_queue_payload
    from public.jobs j
    where j.idempotency_key = v_idempotency_key;

    if v_queue_id is null
       or v_queue_kind <> 'prospect_csv_import'
       or v_queue_payload->>'importJobId' <> p_import_job_id::text
       or v_queue_payload->>'listId' <> p_expected_list_id::text then
      raise exception 'prospect import idempotency key collision';
    end if;
  end if;

  update public.prospect_import_jobs
  set status = 'ready',
      column_mapping = coalesce(p_column_mapping, '{}'::jsonb),
      total_rows = v_total_rows,
      invalid_count = v_invalid_count,
      error_message = null,
      finished_at = null,
      active_queue_job_id = v_queue_id
  where id = p_import_job_id;

  insert into public.audit_logs (
    actor_id,
    actor_name,
    action,
    entity_type,
    notion_page_id,
    changed_fields,
    operation_source
  ) values (
    p_actor_id,
    p_actor_name,
    'prospect_import.committed',
    'prospect_import',
    null,
    pg_catalog.jsonb_build_object(
      'entity_id', p_import_job_id,
      'total_rows', v_total_rows
    ),
    'app'
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'started',
    'totalRows', v_total_rows,
    'queueJobId', v_queue_id
  );
end $$;

create or replace function public.fail_prospect_import_job_if_current(
  p_import_job_id uuid,
  p_list_id uuid,
  p_queue_job_id uuid,
  p_worker_id text,
  p_actor_id uuid,
  p_actor_name text
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_list public.prospect_lists%rowtype;
  v_import public.prospect_import_jobs%rowtype;
  v_queue public.jobs%rowtype;
begin
  -- Keep the same global order as start/chunk/archive. This finalizer runs
  -- before the generic worker marks its queue job failed.
  select l.* into v_list
  from public.prospect_lists l
  where l.id = p_list_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'list_unavailable');
  end if;

  select j.* into v_import
  from public.prospect_import_jobs j
  where j.id = p_import_job_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'import_not_found');
  end if;

  if v_import.prospect_list_id <> p_list_id then
    return pg_catalog.jsonb_build_object('outcome', 'list_mismatch');
  end if;

  if v_import.status in ('completed', 'failed', 'cancelled') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'terminal_noop',
      'status', v_import.status
    );
  end if;

  if v_import.status not in ('ready', 'importing') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'invalid_state',
      'status', v_import.status
    );
  end if;

  if v_import.active_queue_job_id is distinct from p_queue_job_id then
    return pg_catalog.jsonb_build_object('outcome', 'stale_noop');
  end if;

  select j.* into v_queue
  from public.jobs j
  where j.id = p_queue_job_id
  for update;

  if not found
     or v_queue.kind <> 'prospect_csv_import'
     or v_queue.payload->>'importJobId' <> p_import_job_id::text
     or v_queue.payload->>'listId' <> p_list_id::text then
    return pg_catalog.jsonb_build_object('outcome', 'queue_mismatch');
  end if;

  if v_queue.status <> 'running'
     or v_queue.locked_by is distinct from p_worker_id
     or v_queue.lease_expires_at is null
     or v_queue.lease_expires_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('outcome', 'lease_lost');
  end if;

  if v_queue.attempts < v_queue.max_attempts then
    return pg_catalog.jsonb_build_object('outcome', 'retry_remaining');
  end if;

  update public.prospect_import_jobs
  set status = 'failed',
      error_message = 'CSV取込処理が再試行上限に達したため完了できませんでした。CSVを確認して、もう一度取り込んでください。',
      finished_at = pg_catalog.now(),
      active_queue_job_id = null
  where id = p_import_job_id;

  insert into public.audit_logs (
    actor_id,
    actor_name,
    action,
    entity_type,
    notion_page_id,
    changed_fields,
    operation_source
  ) values (
    p_actor_id,
    p_actor_name,
    'prospect_import.failed',
    'prospect_import',
    null,
    pg_catalog.jsonb_build_object(
      'entity_id', p_import_job_id,
      'prospect_list_id', p_list_id,
      'queue_job_id', p_queue_job_id,
      'reason', 'queue_attempts_exhausted'
    ),
    'app'
  );

  return pg_catalog.jsonb_build_object('outcome', 'failed');
end $$;

create or replace function public.archive_prospect_list_if_idle(
  p_list_id uuid,
  p_actor_id uuid,
  p_actor_name text
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_list public.prospect_lists%rowtype;
  v_active_import_id uuid;
  v_active_import_status text;
  v_active_queue_job_id uuid;
  v_active_queue_status public.job_status;
  v_active_queue_found boolean := false;
  v_scan_after_import_id uuid;
  v_blocking_import_id uuid;
  v_blocking_import_status text;
begin
  select l.* into v_list
  from public.prospect_lists l
  where l.id = p_list_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;

  if v_list.status = 'archived' or v_list.archived_at is not null then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_archived',
      'list', pg_catalog.to_jsonb(v_list)
    );
  end if;

  -- The list lock is always acquired before active import and queue locks.
  -- Scan every active import in UUID order. Terminal/orphan queues are all
  -- reconciled, while the first queued/running/paused import is remembered as
  -- the blocker returned only after the full scan.
  loop
    v_active_import_id := null;
    v_active_import_status := null;
    v_active_queue_job_id := null;
    v_active_queue_status := null;
    v_active_queue_found := false;

    select j.id, j.status, j.active_queue_job_id
    into v_active_import_id, v_active_import_status, v_active_queue_job_id
    from public.prospect_import_jobs j
    where j.prospect_list_id = p_list_id
      and j.status in ('ready', 'importing')
      and (
        v_scan_after_import_id is null
        or j.id > v_scan_after_import_id
      )
    order by j.id
    limit 1
    for update;

    exit when v_active_import_id is null;
    v_scan_after_import_id := v_active_import_id;

    -- If the generic queue already reached a terminal state but its finalizer
    -- response was lost, reconcile the import and inspect the next active one.
    if v_active_queue_job_id is not null then
      select j.status into v_active_queue_status
      from public.jobs j
      where j.id = v_active_queue_job_id
      for update;
      v_active_queue_found := found;
    end if;

    if not v_active_queue_found
       or v_active_queue_status in ('succeeded', 'failed', 'cancelled') then
      update public.prospect_import_jobs
      set status = 'failed',
          error_message = 'CSV取込キューを確認できないか終了していたため、取込処理を失敗として終了しました。CSVを確認して、もう一度取り込んでください。',
          finished_at = pg_catalog.now(),
          active_queue_job_id = null
      where id = v_active_import_id
        and status in ('ready', 'importing');

      insert into public.audit_logs (
        actor_id,
        actor_name,
        action,
        entity_type,
        notion_page_id,
        changed_fields,
        operation_source
      ) values (
        p_actor_id,
        p_actor_name,
        'prospect_import.failed',
        'prospect_import',
        null,
        pg_catalog.jsonb_build_object(
          'entity_id', v_active_import_id,
          'prospect_list_id', p_list_id,
          'queue_job_id', v_active_queue_job_id,
          'queue_status', v_active_queue_status,
          'reason', case
            when v_active_queue_job_id is null
              then 'queue_pointer_missing_during_archive'
            when not v_active_queue_found
              then 'queue_job_missing_during_archive'
            else 'terminal_queue_reconciled_during_archive'
          end
        ),
        'app'
      );

      continue;
    end if;

    if v_blocking_import_id is null then
      v_blocking_import_id := v_active_import_id;
      v_blocking_import_status := v_active_import_status;
    end if;
  end loop;

  if v_blocking_import_id is not null then
    return pg_catalog.jsonb_build_object(
      'outcome', 'import_in_progress',
      'importJobId', v_blocking_import_id,
      'importStatus', v_blocking_import_status
    );
  end if;

  update public.prospect_lists
  set status = 'archived',
      archived_at = pg_catalog.now()
  where id = p_list_id
  returning * into v_list;

  insert into public.audit_logs (
    actor_id,
    actor_name,
    action,
    entity_type,
    notion_page_id,
    changed_fields,
    operation_source
  ) values (
    p_actor_id,
    p_actor_name,
    'prospect_list.archived',
    'prospect_list',
    null,
    pg_catalog.jsonb_build_object(
      'entity_id', p_list_id,
      'status', 'archived',
      'archived_at', v_list.archived_at
    ),
    'app'
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'archived',
    'list', pg_catalog.to_jsonb(v_list)
  );
end $$;

create or replace function public.process_prospect_import_chunk_atomic(
  p_import_job_id uuid,
  p_list_id uuid,
  p_queue_job_id uuid,
  p_worker_id text,
  p_cursor_row_number int,
  p_actor_id uuid,
  p_actor_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_list public.prospect_lists%rowtype;
  v_import public.prospect_import_jobs%rowtype;
  v_queue public.jobs%rowtype;
  v_row record;
  v_item jsonb;
  v_core jsonb;
  v_contact jsonb;
  v_formal jsonb;
  v_source_attributes jsonb;
  v_source_hash text;
  v_dedupe_lock_key text;
  v_candidate_prospect_id uuid;
  v_prospect_id uuid;
  v_membership_id uuid;
  v_match_reason text;
  v_row_status text;
  v_probable_id uuid;
  v_probable_prefecture text;
  v_probable_city text;
  v_contact_name text;
  v_contact_normalized_name text;
  v_contact_email text;
  v_contact_normalized_email text;
  v_contact_phone text;
  v_contact_normalized_phone text;
  v_contact_count int;
  v_contact_duplicate boolean;
  v_error_message text;
  v_processed int := 0;
  v_accepted int := 0;
  v_reused int := 0;
  v_probable int := 0;
  v_invalid int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_pending_left int := 0;
  v_next_cursor int := coalesce(p_cursor_row_number, 0);
  v_next_queue_id uuid;
  v_next_idempotency_key text;
begin
  -- One transaction owns the list, import, queue lease, staged rows, and all
  -- business writes. Archive cannot pass the first lock until this finishes.
  select l.* into v_list
  from public.prospect_lists l
  where l.id = p_list_id
  for update;

  select j.* into v_import
  from public.prospect_import_jobs j
  where j.id = p_import_job_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'import_not_found');
  end if;

  if v_import.prospect_list_id <> p_list_id then
    return pg_catalog.jsonb_build_object('outcome', 'list_mismatch');
  end if;

  -- A retry that arrives after the final checkpoint must never reopen or fail
  -- the import, even if the list has since been archived.
  if v_import.status in ('completed', 'failed', 'cancelled') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'terminal_noop',
      'status', v_import.status,
      'done', true,
      'nextCursor', v_next_cursor,
      'accepted', 0,
      'reused', 0,
      'probable', 0,
      'invalid', 0,
      'skipped', 0,
      'failed', 0
    );
  end if;

  if v_list.id is null
     or v_list.status = 'archived'
     or v_list.archived_at is not null then
    return pg_catalog.jsonb_build_object('outcome', 'list_unavailable');
  end if;

  if v_import.status not in ('ready', 'importing') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'invalid_state',
      'status', v_import.status
    );
  end if;

  if v_import.active_queue_job_id is not null
     and v_import.active_queue_job_id is distinct from p_queue_job_id then
    return pg_catalog.jsonb_build_object(
      'outcome', 'stale_noop',
      'done', true,
      'nextCursor', v_next_cursor,
      'accepted', 0,
      'reused', 0,
      'probable', 0,
      'invalid', 0,
      'skipped', 0,
      'failed', 0
    );
  end if;

  -- Verify and lock the exact generic-job lease before staged/business rows.
  select j.* into v_queue
  from public.jobs j
  where j.id = p_queue_job_id
  for update;

  if not found
     or v_queue.kind <> 'prospect_csv_import'
     or v_queue.payload->>'importJobId' <> p_import_job_id::text
     or v_queue.payload->>'listId' <> p_list_id::text then
    return pg_catalog.jsonb_build_object('outcome', 'queue_mismatch');
  end if;

  if v_queue.status <> 'running'
     or v_queue.locked_by is distinct from p_worker_id
     or v_queue.lease_expires_at is null
     or v_queue.lease_expires_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('outcome', 'lease_lost');
  end if;

  -- Forward-only adoption for an import that was already ready/importing
  -- before active_queue_job_id existed. The list/import locks make exactly one
  -- live queue lease the winner; later jobs observe a pointer mismatch.
  if v_import.active_queue_job_id is null then
    update public.prospect_import_jobs
    set active_queue_job_id = p_queue_job_id
    where id = p_import_job_id;
    v_import.active_queue_job_id := p_queue_job_id;
  end if;

  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    return pg_catalog.jsonb_build_object('outcome', 'invalid_payload');
  end if;

  -- Different lists have different parent-row locks. Acquire every non-null
  -- high-confidence key for the entire chunk in one global lexical order.
  -- Per-row ordering is insufficient when two chunks contain A→B and B→A.
  for v_dedupe_lock_key in
    select distinct all_keys.lock_key
    from pg_catalog.jsonb_array_elements(p_rows) item
    cross join lateral (
      values
        (
          case
            when nullif(item->'core'->>'normalizedDomain', '') is null then null
            else 'domain:' || (item->'core'->>'normalizedDomain')
          end
        ),
        (
          case
            when nullif(item->'core'->>'normalizedPhone', '') is null then null
            else 'phone:' || (item->'core'->>'normalizedPhone')
          end
        ),
        (
          case
            when nullif(item->'contact'->>'normalizedEmail', '') is null then null
            else 'email:' || (item->'contact'->>'normalizedEmail')
          end
        )
    ) as all_keys(lock_key)
    where all_keys.lock_key is not null
    order by all_keys.lock_key
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_dedupe_lock_key, 130013)
    );
  end loop;

  -- The same prospect can be reached through different keys (for example,
  -- domain in one chunk and phone in another). Pre-lock the complete current
  -- high-confidence candidate set by UUID so later per-row lookup never takes
  -- prospect locks in a chunk-dependent order.
  for v_candidate_prospect_id in
    select distinct candidates.prospect_id
    from (
      select p.id as prospect_id
      from public.prospects p
      where p.archived_at is null
        and p.normalized_domain in (
          select nullif(item->'core'->>'normalizedDomain', '')
          from pg_catalog.jsonb_array_elements(p_rows) item
        )
      union
      select p.id as prospect_id
      from public.prospects p
      where p.archived_at is null
        and p.normalized_phone in (
          select nullif(item->'core'->>'normalizedPhone', '')
          from pg_catalog.jsonb_array_elements(p_rows) item
        )
      union
      select p.id as prospect_id
      from public.prospect_contacts c
      join public.prospects p on p.id = c.prospect_id
      where c.archived_at is null
        and p.archived_at is null
        and c.normalized_email in (
          select nullif(item->'contact'->>'normalizedEmail', '')
          from pg_catalog.jsonb_array_elements(p_rows) item
        )
    ) candidates
    order by candidates.prospect_id
  loop
    perform p.id
    from public.prospects p
    where p.id = v_candidate_prospect_id
    for update;
  end loop;

  update public.prospect_import_jobs
  set status = 'importing'
  where id = p_import_job_id;

  for v_row in
    select r.*, payload.item as normalized_payload
    from public.prospect_import_rows r
    join lateral (
      select value as item
      from pg_catalog.jsonb_array_elements(p_rows) value
      where value->>'rowId' = r.id::text
      limit 1
    ) payload on true
    where r.prospect_import_job_id = p_import_job_id
      and r.status = 'pending'
      and r.row_number > coalesce(p_cursor_row_number, 0)
    order by r.row_number, r.id
    limit 40
    -- active_queue_job_id plus the import-job lock already serialize workers
    -- for this import. Waiting here preserves a contiguous cursor; skipping a
    -- locked row could strand it after v_next_cursor advances past it.
    for update of r
  loop
    v_processed := v_processed + 1;
    v_next_cursor := v_row.row_number;
    v_item := v_row.normalized_payload;
    v_core := v_item->'core';
    v_contact := v_item->'contact';
    v_formal := v_item->'formalMatch';
    v_source_attributes := coalesce(
      v_item->'sourceAttributes',
      '{}'::jsonb
    );
    v_source_hash := nullif(v_item->>'sourceRowHash', '');
    v_prospect_id := null;
    v_membership_id := null;
    v_match_reason := null;
    v_row_status := 'accepted';
    v_probable_id := null;
    v_probable_prefecture := null;
    v_probable_city := null;

    begin
      if nullif(pg_catalog.btrim(v_core->>'companyName'), '') is null
         or v_source_hash is null then
        update public.prospect_import_rows
        set status = 'invalid',
            error_message = '会社名または取込行ハッシュがありません'
        where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      -- Same-list source hash is the first idempotency boundary.
      select m.id, m.prospect_id
      into v_membership_id, v_prospect_id
      from public.prospect_list_memberships m
      where m.prospect_list_id = p_list_id
        and m.source_row_hash = v_source_hash
        and m.archived_at is null
      order by m.id
      limit 1
      for update;

      if v_membership_id is not null then
        update public.prospect_import_rows
        set status = 'skipped',
            source_row_hash = v_source_hash,
            prospect_id = v_prospect_id,
            membership_id = v_membership_id,
            match_reason = 'source_row_hash',
            error_message = null
        where id = v_row.id;
        v_skipped := v_skipped + 1;
        continue;
      end if;

      -- Preserve the existing high-confidence precedence:
      -- exact domain, then company phone, then contact email.
      if nullif(v_core->>'normalizedDomain', '') is not null then
        select p.id into v_prospect_id
        from public.prospects p
        where p.normalized_domain = v_core->>'normalizedDomain'
          and p.archived_at is null
        order by p.created_at, p.id
        limit 1;
        if v_prospect_id is not null then
          v_row_status := 'reused';
          v_match_reason := 'high:domain';
        end if;
      end if;

      if v_prospect_id is null
         and nullif(v_core->>'normalizedPhone', '') is not null then
        select p.id into v_prospect_id
        from public.prospects p
        where p.normalized_phone = v_core->>'normalizedPhone'
          and p.archived_at is null
        order by p.created_at, p.id
        limit 1;
        if v_prospect_id is not null then
          v_row_status := 'reused';
          v_match_reason := 'high:phone';
        end if;
      end if;

      if v_prospect_id is null
         and nullif(v_contact->>'normalizedEmail', '') is not null then
        select p.id into v_prospect_id
        from public.prospect_contacts c
        join public.prospects p on p.id = c.prospect_id
        where c.normalized_email = v_contact->>'normalizedEmail'
          and c.archived_at is null
          and p.archived_at is null
        order by c.created_at, c.id
        limit 1;
        if v_prospect_id is not null then
          v_row_status := 'reused';
          v_match_reason := 'high:contact_email';
        end if;
      end if;

      -- Company-name-only remains probable and never auto-reuses.
      if v_prospect_id is null
         and nullif(v_core->>'normalizedCompanyName', '') is not null then
        select p.id, p.prefecture, p.city
        into v_probable_id, v_probable_prefecture, v_probable_city
        from public.prospects p
        where p.normalized_company_name = v_core->>'normalizedCompanyName'
          and p.archived_at is null
        order by p.created_at, p.id
        limit 1;
      end if;

      if v_prospect_id is null then
        insert into public.prospects (
          company_name,
          normalized_company_name,
          website_url,
          normalized_domain,
          main_phone,
          normalized_phone,
          postal_code,
          prefecture,
          city,
          address,
          industry,
          employee_range,
          notes,
          search_text,
          duplicate_review_status,
          formal_org_match_page_id,
          formal_org_match_external_id,
          formal_org_match_confidence,
          created_by
        ) values (
          v_core->>'companyName',
          coalesce(v_core->>'normalizedCompanyName', ''),
          nullif(v_core->>'websiteUrl', ''),
          nullif(v_core->>'normalizedDomain', ''),
          nullif(v_core->>'mainPhone', ''),
          nullif(v_core->>'normalizedPhone', ''),
          nullif(v_core->>'postalCode', ''),
          nullif(v_core->>'prefecture', ''),
          nullif(v_core->>'city', ''),
          nullif(v_core->>'address', ''),
          nullif(v_core->>'industry', ''),
          nullif(v_core->>'employeeRange', ''),
          nullif(v_item->>'notes', ''),
          coalesce(v_core->>'searchText', ''),
          case when v_probable_id is null then 'none' else 'probable' end,
          nullif(v_formal->>'pageId', ''),
          nullif(v_formal->>'externalId', ''),
          nullif(v_formal->>'confidence', ''),
          p_actor_id
        )
        returning id into v_prospect_id;

        if v_probable_id is not null then
          v_row_status := 'probable_duplicate';
          v_match_reason := pg_catalog.format(
            'probable:%s:%s',
            case
              when nullif(v_core->>'prefecture', '') is not null
                   and v_probable_prefecture is not null
                   and v_core->>'prefecture' = v_probable_prefecture
                   and (
                     nullif(v_core->>'city', '') is null
                     or v_probable_city is null
                     or v_core->>'city' = v_probable_city
                   )
                then 'company_name_location'
              else 'company_name'
            end,
            v_probable_id
          );
        end if;

        insert into public.audit_logs (
          actor_id,
          actor_name,
          action,
          entity_type,
          notion_page_id,
          changed_fields,
          operation_source
        ) values (
          p_actor_id,
          p_actor_name,
          'prospect.created',
          'prospect',
          null,
          pg_catalog.jsonb_build_object(
            'entity_id', v_prospect_id,
            'company_name', v_core->>'companyName',
            'import_job_id', p_import_job_id
          ),
          'app'
        );
      end if;

      select m.id into v_membership_id
      from public.prospect_list_memberships m
      where m.prospect_list_id = p_list_id
        and m.prospect_id = v_prospect_id
        and m.archived_at is null
      order by m.id
      limit 1
      for update;

      if v_membership_id is not null then
        update public.prospect_list_memberships
        set source_row_hash = v_source_hash,
            source_record_id = nullif(v_item->>'externalRecordId', ''),
            source_attributes = v_source_attributes
        where id = v_membership_id;
        if v_row_status = 'accepted' then
          v_row_status := 'reused';
        end if;
      else
        insert into public.prospect_list_memberships (
          prospect_list_id,
          prospect_id,
          stage,
          source_record_id,
          source_row_hash,
          source_attributes,
          notes
        ) values (
          p_list_id,
          v_prospect_id,
          'new',
          nullif(v_item->>'externalRecordId', ''),
          v_source_hash,
          v_source_attributes,
          nullif(v_item->>'notes', '')
        )
        returning id into v_membership_id;

        insert into public.audit_logs (
          actor_id,
          actor_name,
          action,
          entity_type,
          notion_page_id,
          changed_fields,
          operation_source
        ) values (
          p_actor_id,
          p_actor_name,
          'prospect_membership.added',
          'prospect_membership',
          null,
          pg_catalog.jsonb_build_object(
            'entity_id', v_membership_id,
            'prospect_id', v_prospect_id,
            'prospect_list_id', p_list_id
          ),
          'app'
        );
      end if;

      v_contact_name := nullif(v_contact->>'name', '');
      if v_contact_name is not null then
        v_contact_normalized_name := coalesce(
          v_contact->>'normalizedName',
          ''
        );
        v_contact_email := nullif(v_contact->>'email', '');
        v_contact_normalized_email := nullif(
          v_contact->>'normalizedEmail',
          ''
        );
        v_contact_phone := nullif(v_contact->>'phone', '');
        v_contact_normalized_phone := nullif(
          v_contact->>'normalizedPhone',
          ''
        );

        perform c.id
        from public.prospect_contacts c
        where c.prospect_id = v_prospect_id
          and c.archived_at is null
        order by c.id
        for update;

        select pg_catalog.count(*)::int,
               coalesce(
                 pg_catalog.bool_or(
                   (
                     v_contact_normalized_email is not null
                     and c.normalized_email = v_contact_normalized_email
                   )
                   or (
                     v_contact_normalized_phone is not null
                     and c.normalized_phone = v_contact_normalized_phone
                   )
                   or (
                     v_contact_normalized_email is null
                     and c.normalized_name = v_contact_normalized_name
                   )
                 ),
                 false
               )
        into v_contact_count, v_contact_duplicate
        from public.prospect_contacts c
        where c.prospect_id = v_prospect_id
          and c.archived_at is null;

        if not v_contact_duplicate then
          insert into public.prospect_contacts (
            prospect_id,
            name,
            normalized_name,
            department,
            title,
            email,
            normalized_email,
            phone,
            normalized_phone,
            is_primary
          ) values (
            v_prospect_id,
            v_contact_name,
            v_contact_normalized_name,
            nullif(v_contact->>'department', ''),
            nullif(v_contact->>'title', ''),
            v_contact_email,
            v_contact_normalized_email,
            v_contact_phone,
            v_contact_normalized_phone,
            v_contact_count = 0
          );
        end if;
      end if;

      if v_formal is not null
         and pg_catalog.jsonb_typeof(v_formal) = 'object'
         and nullif(v_formal->>'pageId', '') is not null then
        update public.prospects
        set formal_org_match_page_id = v_formal->>'pageId',
            formal_org_match_external_id = nullif(v_formal->>'externalId', ''),
            formal_org_match_confidence = nullif(v_formal->>'confidence', '')
        where id = v_prospect_id;
      end if;

      update public.prospect_import_rows
      set status = v_row_status,
          source_row_hash = v_source_hash,
          prospect_id = v_prospect_id,
          membership_id = v_membership_id,
          match_reason = v_match_reason,
          error_message = null
      where id = v_row.id;

      case v_row_status
        when 'accepted' then v_accepted := v_accepted + 1;
        when 'reused' then v_reused := v_reused + 1;
        when 'probable_duplicate' then v_probable := v_probable + 1;
        when 'invalid' then v_invalid := v_invalid + 1;
        when 'skipped' then v_skipped := v_skipped + 1;
        else v_failed := v_failed + 1;
      end case;
    exception when others then
      get stacked diagnostics v_error_message = message_text;
      update public.prospect_import_rows
      set status = 'failed',
          source_row_hash = v_source_hash,
          prospect_id = null,
          membership_id = null,
          match_reason = null,
          error_message = pg_catalog.substr(v_error_message, 1, 2000)
      where id = v_row.id;
      v_failed := v_failed + 1;
    end;
  end loop;

  select pg_catalog.count(*)::int into v_pending_left
  from public.prospect_import_rows r
  where r.prospect_import_job_id = p_import_job_id
    and r.status = 'pending';

  if v_processed = 0 and v_pending_left > 0 then
    return pg_catalog.jsonb_build_object(
      'outcome', 'payload_required',
      'done', false,
      'nextCursor', v_next_cursor,
      'accepted', 0,
      'reused', 0,
      'probable', 0,
      'invalid', 0,
      'skipped', 0,
      'failed', 0
    );
  end if;

  if v_pending_left = 0 then
    update public.prospect_import_jobs
    set accepted_count = accepted_count + v_accepted,
        reused_count = reused_count + v_reused,
        probable_duplicate_count = probable_duplicate_count + v_probable,
        invalid_count = invalid_count + v_invalid,
        skipped_count = skipped_count + v_skipped,
        status = 'completed',
        finished_at = pg_catalog.now(),
        error_message = null,
        active_queue_job_id = null
    where id = p_import_job_id;

    return pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'done', true,
      'nextCursor', v_next_cursor,
      'accepted', v_accepted,
      'reused', v_reused,
      'probable', v_probable,
      'invalid', v_invalid,
      'skipped', v_skipped,
      'failed', v_failed
    );
  end if;

  v_next_idempotency_key := pg_catalog.format(
    'prospect_csv_import:%s:%s',
    p_import_job_id,
    v_next_cursor
  );

  perform pg_catalog.set_config(
    'app.atomic_prospect_import_enqueue',
    'on',
    true
  );
  insert into public.jobs (
    kind,
    priority,
    payload,
    idempotency_key,
    created_by
  ) values (
    'prospect_csv_import',
    40,
    pg_catalog.jsonb_build_object(
      'importJobId', p_import_job_id,
      'listId', p_list_id,
      'cursorRowNumber', v_next_cursor,
      'actorId', p_actor_id,
      'actorName', p_actor_name
    ),
    v_next_idempotency_key,
    p_actor_id
  )
  on conflict (idempotency_key) do nothing
  returning id into v_next_queue_id;
  perform pg_catalog.set_config(
    'app.atomic_prospect_import_enqueue',
    'off',
    true
  );

  if v_next_queue_id is null then
    select j.id into v_next_queue_id
    from public.jobs j
    where j.idempotency_key = v_next_idempotency_key
      and j.kind = 'prospect_csv_import'
      and j.payload->>'importJobId' = p_import_job_id::text
      and j.payload->>'listId' = p_list_id::text;

    if v_next_queue_id is null then
      raise exception 'prospect import next-job idempotency key collision';
    end if;
  end if;

  update public.prospect_import_jobs
  set accepted_count = accepted_count + v_accepted,
      reused_count = reused_count + v_reused,
      probable_duplicate_count = probable_duplicate_count + v_probable,
      invalid_count = invalid_count + v_invalid,
      skipped_count = skipped_count + v_skipped,
      status = 'importing',
      error_message = null,
      active_queue_job_id = v_next_queue_id
  where id = p_import_job_id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'processed',
    'done', false,
    'nextCursor', v_next_cursor,
    'nextQueueJobId', v_next_queue_id,
    'accepted', v_accepted,
    'reused', v_reused,
    'probable', v_probable,
    'invalid', v_invalid,
    'skipped', v_skipped,
    'failed', v_failed
  );
end $$;

revoke execute on function public.start_prospect_import_job(
  uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.start_prospect_import_job(
  uuid, uuid, uuid, text, jsonb
) to service_role;

revoke execute on function public.fail_prospect_import_job_if_current(
  uuid, uuid, uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.fail_prospect_import_job_if_current(
  uuid, uuid, uuid, text, uuid, text
) to service_role;

revoke execute on function public.archive_prospect_list_if_idle(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.archive_prospect_list_if_idle(
  uuid, uuid, text
) to service_role;

revoke execute on function public.process_prospect_import_chunk_atomic(
  uuid, uuid, uuid, text, int, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.process_prospect_import_chunk_atomic(
  uuid, uuid, uuid, text, int, uuid, text, jsonb
) to service_role;
