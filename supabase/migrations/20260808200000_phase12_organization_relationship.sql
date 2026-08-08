-- Phase 12: Organization relationships on customer_index (Notion SSoT)
-- technical entity remains customer; product concept is organization

alter table public.customer_index
  add column if not exists relationship_ids text[] not null default '{}',
  add column if not exists relationship_semantic_keys text[] not null default '{}';

comment on column public.customer_index.relationship_ids is
  'Notion masters「関係性」page IDs（非正規化）。正式値は Notion。';
comment on column public.customer_index.relationship_semantic_keys is
  '関係性 semantic_key 配列。一覧 filter / badge 用。正式値は Notion。';

create index if not exists customer_index_relationship_ids_gin
  on public.customer_index using gin (relationship_ids);

create index if not exists customer_index_relationship_semantic_keys_gin
  on public.customer_index using gin (relationship_semantic_keys);
