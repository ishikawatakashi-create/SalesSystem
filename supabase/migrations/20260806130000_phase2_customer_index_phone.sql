-- Phase 2: customer_index に表示用電話番号原文を追加。
-- 検索は既存 phone_normalized、表示は phone(原文) と分離する。
-- docs/supabase-schema.md の検索のみでは不足していたため明示追加。

alter table public.customer_index
  add column if not exists phone text;

comment on column public.customer_index.phone is
  '表示用電話番号原文。検索照合は phone_normalized を用いる';

comment on column public.customer_index.phone_normalized is
  '検索用電話番号(数字のみ正規化)';
