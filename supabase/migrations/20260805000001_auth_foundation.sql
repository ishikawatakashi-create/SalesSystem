-- ============================================================
-- 認証基盤(Phase 1 認証スパイク範囲)
-- app_users / user_invitations / current_app_role /
-- Before User Created Hook
-- 設計: docs/supabase-schema.md / docs/permissions.md
-- ============================================================

-- ---- 型定義 ----
create type public.app_role as enum ('admin', 'a', 'b', 'viewer');
create type public.provisioning_status as enum
  ('pending', 'auth_created', 'profile_created', 'completed', 'failed');
create type public.invitation_status as enum
  ('pending', 'accepted', 'revoked', 'expired');

-- ---- 共通: updated_at自動更新 ----
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---- 招待(招待の正) ----
create table public.user_invitations (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  normalized_email text not null,
  display_name     text not null,
  role             public.app_role not null,
  status           public.invitation_status not null default 'pending',
  invited_by       uuid,
  -- 招待時にSupabase AuthのEmail OTP Expirationと同じ期限を必ず明示する。
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now()
);

-- 有効(pending)な招待はメールアドレスごとに1件のみ。
-- expires_atは部分インデックス条件に使わない(期限切れはジョブがstatus=expiredへ更新する)。
create unique index user_invitations_pending_email_uniq
  on public.user_invitations (normalized_email)
  where status = 'pending';

create index user_invitations_status_expires_idx
  on public.user_invitations (status, expires_at);

-- ---- アプリユーザー ----
create table public.app_users (
  id                   uuid primary key references auth.users (id) on delete restrict,
  email                text not null,
  display_name         text not null,
  role                 public.app_role not null default 'viewer',
  department_role      text,
  is_active            boolean not null default true,
  provisioning_status  public.provisioning_status not null default 'pending',
  provisioning_error   text,
  notion_staff_page_id text unique,
  invitation_id        uuid references public.user_invitations (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger app_users_set_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

-- invited_by の参照(app_users作成後に追加)
alter table public.user_invitations
  add constraint user_invitations_invited_by_fkey
  foreign key (invited_by) references public.app_users (id);

-- ---- 現在ユーザーのロール取得(RLSポリシーから参照) ----
create function public.current_app_role() returns public.app_role
language sql stable
security definer set search_path = ''
as $$
  select role from public.app_users
  where id = auth.uid() and is_active
$$;

revoke execute on function public.current_app_role() from public, anon;
grant  execute on function public.current_app_role() to authenticated, service_role;

-- ---- Before User Created Hook ----
-- Supabaseダッシュボードの Authentication > Hooks で
-- "Before User Created" にこの関数を設定すること。
-- 有効な招待(status='pending' かつ 期限内)が存在しないメールアドレスの
-- ユーザー作成を拒否する(Google OAuth経由の未招待アカウント作成も防ぐ)。
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_email text;
  v_ok    boolean;
begin
  -- 公式ペイロードevent.user.emailだけを参照。欠落時はフェイルクローズする。
  v_email := pg_catalog.lower(pg_catalog.btrim(event #>> '{user,email}'));

  if v_email is null or v_email = '' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'このアカウントは利用登録されていません。'
      )
    );
  end if;

  select exists (
    select 1 from public.user_invitations
    where normalized_email = v_email
      and status = 'pending'
      and expires_at >= pg_catalog.now()
  ) into v_ok;

  if not v_ok then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'このアカウントは利用登録されていません。'
      )
    );
  end if;

  -- 公式仕様: 許可時は空JSONを返す。
  return '{}'::jsonb;
end $$;

revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant  execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- ---- RLS ----
alter table public.app_users        enable row level security;
alter table public.user_invitations enable row level security;

-- app_users: 認証済み全員が閲覧可(担当者名の表示等に必要)。書込はSecret key経由のみ(ポリシーなし=拒否)
create policy app_users_select on public.app_users
  for select to authenticated
  using (public.current_app_role() is not null or id = auth.uid());

-- user_invitations: adminのみ閲覧可。書込はSecret key経由のみ
create policy user_invitations_select on public.user_invitations
  for select to authenticated
  using (public.current_app_role() = 'admin');
