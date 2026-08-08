-- Phase 11: Gmail 返信下書き request / nonce（加算のみ）

create table if not exists public.inquiry_draft_requests (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries (id) on delete cascade,
  draft_request_id text not null,
  from_alias text,
  created_by uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inquiry_draft_requests_request_id_unique unique (draft_request_id)
);

create index if not exists inquiry_draft_requests_inquiry_created_idx
  on public.inquiry_draft_requests (inquiry_id, created_at desc);

comment on table public.inquiry_draft_requests is
  'Apps Script Gmail draft 作成要求の短い記録。本文は保存しない。';

create table if not exists public.apps_script_request_nonces (
  nonce text primary key,
  purpose text not null,
  created_at timestamptz not null default now()
);

create index if not exists apps_script_request_nonces_created_idx
  on public.apps_script_request_nonces (created_at);

alter table public.inquiry_draft_requests enable row level security;
alter table public.apps_script_request_nonces enable row level security;

-- service role / admin client のみ利用。authenticated 直接アクセスは不要
