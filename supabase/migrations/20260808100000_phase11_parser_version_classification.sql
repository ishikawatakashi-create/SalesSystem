-- Phase 11: parser_version + ingest_classification（加算のみ。物理削除なし）

alter table public.inquiries
  add column if not exists parser_version integer not null default 1;

alter table public.inquiries
  add column if not exists ingest_classification text not null default 'source';

alter table public.inquiries
  drop constraint if exists inquiries_ingest_classification_check;

alter table public.inquiries
  add constraint inquiries_ingest_classification_check
  check (ingest_classification in ('source', 'ignored_non_source'));

comment on column public.inquiries.parser_version is
  'Strikingly parser 版。古い版の再POST時は source-derived fields のみ更新可。';

comment on column public.inquiries.ingest_classification is
  'source=正規取込。ignored_non_source=返信等で一覧/badge 対象外（物理削除しない）。';

create index if not exists inquiries_list_source_idx
  on public.inquiries (received_at desc)
  where ingest_classification = 'source';

create index if not exists inquiries_badge_new_source_idx
  on public.inquiries (received_at desc)
  where status = 'new'
    and historical_import = false
    and ingest_classification = 'source';
