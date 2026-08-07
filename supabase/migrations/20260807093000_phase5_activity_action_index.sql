-- Phase 5(作業呼称): activity_index / action_index に一覧・検索用列を加算追加。
-- 既存列の削除・型変更・データ初期化は行わない。

-- activity_index: 先方担当者・検索文字列
alter table public.activity_index
  add column if not exists contact_page_ids text[] not null default '{}';

alter table public.activity_index
  add column if not exists search_text text not null default '';

comment on column public.activity_index.contact_page_ids is
  '先方担当者(顧客担当者)の Notion page ID 配列';

comment on column public.activity_index.search_text is
  '一覧検索用正規化文字列(要約・本文・顧客名・担当者名・案件名・分類名等)';

create index if not exists activity_index_search_text_trgm_idx
  on public.activity_index using gin (search_text gin_trgm_ops);

create index if not exists activity_index_contact_page_ids_idx
  on public.activity_index using gin (contact_page_ids);

create index if not exists activity_index_deal_page_id_idx
  on public.activity_index (deal_page_id);

create index if not exists activity_index_activity_at_idx
  on public.activity_index (activity_at);

-- action_index: 検索文字列・staff page id(assignee_user_id の元)・期限インデックス補強
alter table public.action_index
  add column if not exists search_text text not null default '';

alter table public.action_index
  add column if not exists staff_page_id text;

comment on column public.action_index.search_text is
  '一覧検索用正規化文字列(内容・顧客名・案件名・担当者名等)';

comment on column public.action_index.staff_page_id is
  '自社担当者の Notion staff page ID。assignee_user_id は app_users.id 解決結果';

create index if not exists action_index_search_text_trgm_idx
  on public.action_index using gin (search_text gin_trgm_ops);

create index if not exists action_index_staff_page_id_idx
  on public.action_index (staff_page_id);

create index if not exists action_index_deal_page_id_idx
  on public.action_index (deal_page_id);

create index if not exists action_index_status_id_idx
  on public.action_index (status_id);

create index if not exists action_index_due_date_idx
  on public.action_index (due_date);
