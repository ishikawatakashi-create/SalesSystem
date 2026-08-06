-- Phase 4(作業呼称): deal_index に一覧・検索用列を加算追加。
-- 先方担当者 Notion page IDs / 自社担当者 Notion page IDs / search_text。
-- 既存列の削除・型変更・データ初期化は行わない。

alter table public.deal_index
  add column if not exists contact_page_ids text[] not null default '{}';

alter table public.deal_index
  add column if not exists staff_page_ids text[] not null default '{}';

alter table public.deal_index
  add column if not exists search_text text not null default '';

comment on column public.deal_index.contact_page_ids is
  '先方担当者(顧客担当者)の Notion page ID 配列';

comment on column public.deal_index.staff_page_ids is
  '自社担当者の Notion staff page ID 配列。staff_user_ids は app_users.id 解決結果';

comment on column public.deal_index.search_text is
  '一覧検索用正規化文字列(案件名・顧客名・担当者名等)';

create index if not exists deal_index_search_text_trgm_idx
  on public.deal_index using gin (search_text gin_trgm_ops);

create index if not exists deal_index_contact_page_ids_idx
  on public.deal_index using gin (contact_page_ids);

create index if not exists deal_index_staff_page_ids_idx
  on public.deal_index using gin (staff_page_ids);

create index if not exists deal_index_stage_id_idx
  on public.deal_index (stage_id);

create index if not exists deal_index_expected_amount_idx
  on public.deal_index (expected_amount);
