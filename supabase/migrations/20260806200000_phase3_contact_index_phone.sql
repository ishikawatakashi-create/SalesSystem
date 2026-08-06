-- Phase 3: contact_index に表示用電話番号原文と検索用インデックスを追加。
-- 検索は既存 phone_normalized、表示は phone(原文) と分離する。
-- 既存列の削除・型変更・データ初期化は行わない。

alter table public.contact_index
  add column if not exists phone text;

comment on column public.contact_index.phone is
  '表示用電話番号原文。検索照合は phone_normalized を用いる';

comment on column public.contact_index.phone_normalized is
  '検索用電話番号(数字のみ正規化)';

create index if not exists contact_index_search_text_trgm_idx
  on public.contact_index using gin (search_text gin_trgm_ops);

create index if not exists contact_index_phone_normalized_idx
  on public.contact_index (phone_normalized);

create index if not exists contact_index_customer_page_id_idx
  on public.contact_index (customer_page_id);

create index if not exists contact_index_contact_type_id_idx
  on public.contact_index (contact_type_id);

create index if not exists contact_index_is_active_idx
  on public.contact_index (is_active);

create index if not exists contact_index_name_idx
  on public.contact_index (name);
