-- Phase 11: 過去問い合わせ backfill 用フラグ（加算のみ）
-- historical_import=true は新着 badge 集計から除外する（status は new のまま）

alter table public.inquiries
  add column if not exists historical_import boolean not null default false;

comment on column public.inquiries.historical_import is
  'Apps Script backfill 由来。true のとき nav/mydesk 新着 badge の集計対象外。status は変更しない。';

create index if not exists inquiries_badge_new_idx
  on public.inquiries (received_at desc)
  where status = 'new' and historical_import = false;
