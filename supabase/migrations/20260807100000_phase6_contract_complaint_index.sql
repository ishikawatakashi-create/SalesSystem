-- Phase 6(作業呼称): contract_index / complaint_index に一覧・検索用列を加算追加。
-- 既存列の削除・型変更・データ初期化は行わない。

-- contract_index
alter table public.contract_index
  add column if not exists search_text text not null default '';

alter table public.contract_index
  add column if not exists staff_page_ids text[] not null default '{}';

alter table public.contract_index
  add column if not exists billing_terms text;

comment on column public.contract_index.search_text is
  '一覧検索用正規化文字列(契約名・顧客名・案件名・備考等)';

comment on column public.contract_index.staff_page_ids is
  '担当者(自社)の Notion staff page ID 配列。staff_user_ids は app_users.id 解決結果';

comment on column public.contract_index.billing_terms is
  '請求条件(表示用原文)';

create index if not exists contract_index_search_text_trgm_idx
  on public.contract_index using gin (search_text gin_trgm_ops);

create index if not exists contract_index_staff_page_ids_idx
  on public.contract_index using gin (staff_page_ids);

create index if not exists contract_index_customer_page_id_idx
  on public.contract_index (customer_page_id);

create index if not exists contract_index_deal_page_id_idx
  on public.contract_index (deal_page_id);

create index if not exists contract_index_status_semantic_idx
  on public.contract_index (status_semantic);

create index if not exists contract_index_end_date_idx
  on public.contract_index (end_date);

-- complaint_index
alter table public.complaint_index
  add column if not exists search_text text not null default '';

alter table public.complaint_index
  add column if not exists staff_page_id text;

comment on column public.complaint_index.search_text is
  '一覧検索用正規化文字列(タイトル・概要・顧客名・案件名・備考等)';

comment on column public.complaint_index.staff_page_id is
  '対応責任者の Notion staff page ID。assignee_user_id は app_users.id 解決結果';

create index if not exists complaint_index_search_text_trgm_idx
  on public.complaint_index using gin (search_text gin_trgm_ops);

create index if not exists complaint_index_staff_page_id_idx
  on public.complaint_index (staff_page_id);

create index if not exists complaint_index_customer_page_id_idx
  on public.complaint_index (customer_page_id);

create index if not exists complaint_index_deal_page_id_idx
  on public.complaint_index (deal_page_id);

create index if not exists complaint_index_status_semantic_idx
  on public.complaint_index (status_semantic);

create index if not exists complaint_index_occurred_on_idx
  on public.complaint_index (occurred_on);

create index if not exists complaint_index_severity_id_idx
  on public.complaint_index (severity_id);
