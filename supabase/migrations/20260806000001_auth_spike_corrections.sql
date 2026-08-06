-- ============================================================
-- 認証技術スパイク是正
-- 1. Before User Created Hookを公式payload/responseへ準拠
-- 2. 招待期限をアプリから必ず明示(Email OTP Expirationと同期)
-- 3. 招待受諾とapp_users作成を単一トランザクション化
-- ============================================================

-- Email OTP ExpirationはSupabase Auth側の設定であり、DBから安全に参照できない。
-- アプリが同じ秒数からexpires_atを算出して必ず指定するため、DB既定値を廃止する。
alter table public.user_invitations
  alter column expires_at drop default;

-- 旧暫定実装がNotionページ未作成でもcompletedとしていた行を是正する。
update public.app_users
   set provisioning_status = 'profile_created'
 where provisioning_status = 'completed'
   and notion_staff_page_id is null;

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_email text;
  v_invited boolean;
begin
  -- Supabase Authの公式Before User Created payloadだけを参照する。
  -- event.user.emailが欠落・空の場合はフォールバックせずフェイルクローズする。
  v_email := pg_catalog.lower(pg_catalog.btrim(event #>> '{user,email}'));

  if v_email is null or v_email = '' then
    return pg_catalog.jsonb_build_object(
      'error', pg_catalog.jsonb_build_object(
        'http_code', 403,
        'message', 'このアカウントは利用登録されていません。'
      )
    );
  end if;

  select exists (
    select 1
      from public.user_invitations
     where normalized_email = v_email
       and status = 'pending'
       and expires_at >= pg_catalog.now()
  ) into v_invited;

  if not v_invited then
    return pg_catalog.jsonb_build_object(
      'error', pg_catalog.jsonb_build_object(
        'http_code', 403,
        'message', 'このアカウントは利用登録されていません。'
      )
    );
  end if;

  -- 公式仕様: 成功時は空のJSONオブジェクトを返す。
  return '{}'::jsonb;
end $$;

revoke execute on function public.hook_before_user_created(jsonb)
  from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb)
  to supabase_auth_admin;

-- Authユーザー作成後、app_users作成と招待受諾を原子的に行う。
-- Notion自社担当者ページ未作成のため、認証スパイク中はprofile_createdまで進める。
create or replace function public.accept_invitation_and_provision(
  p_user_id uuid,
  p_email text
)
returns public.app_users
language plpgsql
security definer set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_invitation public.user_invitations;
  v_app_user public.app_users;
begin
  if not exists (
    select 1
      from auth.users
     where id = p_user_id
       and pg_catalog.lower(email) = v_email
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'auth user mismatch';
  end if;

  select *
    into v_invitation
    from public.user_invitations
   where normalized_email = v_email
     and status = 'pending'
     and expires_at >= pg_catalog.now()
   for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'valid invitation not found';
  end if;

  insert into public.app_users (
    id,
    email,
    display_name,
    role,
    provisioning_status,
    invitation_id
  ) values (
    p_user_id,
    p_email,
    v_invitation.display_name,
    v_invitation.role,
    'profile_created',
    v_invitation.id
  )
  returning * into v_app_user;

  update public.user_invitations
     set status = 'accepted',
         accepted_at = pg_catalog.now()
   where id = v_invitation.id
     and status = 'pending';

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'invitation transition failed';
  end if;

  return v_app_user;
end $$;

revoke execute on function public.accept_invitation_and_provision(uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_invitation_and_provision(uuid, text)
  to service_role;
