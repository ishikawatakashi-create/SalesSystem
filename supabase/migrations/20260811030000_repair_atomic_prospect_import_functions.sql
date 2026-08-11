-- Repair the three P1 routines whose first Production definition qualified
-- COALESCE as pg_catalog.coalesce. COALESCE is PostgreSQL syntax, not a normal
-- function, so schema qualification is accepted at CREATE time but fails when
-- the affected expression executes.
--
-- pg_get_functiondef keeps each routine's exact deployed signature and body.
-- CREATE OR REPLACE preserves ownership and ACLs. On a fresh database the
-- preceding migration is already corrected, making this forward repair a no-op.

do $repair$
declare
  v_function regprocedure;
  v_definition text;
begin
  foreach v_function in array array[
    'public.guard_atomic_prospect_import_enqueue()'::regprocedure,
    'public.start_prospect_import_job(uuid,uuid,uuid,text,jsonb)'::regprocedure,
    'public.process_prospect_import_chunk_atomic(uuid,uuid,uuid,text,integer,uuid,text,jsonb)'::regprocedure
  ]
  loop
    select pg_catalog.pg_get_functiondef(v_function::oid)
    into v_definition;

    if pg_catalog.strpos(v_definition, 'pg_catalog.coalesce') > 0 then
      execute pg_catalog.replace(
        v_definition,
        'pg_catalog.coalesce',
        'coalesce'
      );
    end if;
  end loop;
end
$repair$;

do $verify$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = any (array[
      'public.guard_atomic_prospect_import_enqueue()'::regprocedure::oid,
      'public.start_prospect_import_job(uuid,uuid,uuid,text,jsonb)'::regprocedure::oid,
      'public.process_prospect_import_chunk_atomic(uuid,uuid,uuid,text,integer,uuid,text,jsonb)'::regprocedure::oid
    ])
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(p.oid),
        'pg_catalog.coalesce'
      ) > 0
  ) then
    raise exception using
      errcode = '55000',
      message = 'atomic prospect import function repair did not complete';
  end if;
end
$verify$;
