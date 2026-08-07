-- Phase 7: Notion Webhook verification_token を Vault に保存するための基盤。
-- 平文を system_settings / webhook_events に置かない。
-- status メタデータのみ system_settings に保持する。

create extension if not exists supabase_vault with schema vault;

-- Webhook verification 状態(トークン本体は含めない)
-- value 例: { "status": "awaiting"|"received"|"verified", "received_at": "...", "verified_at": "...", "vault_secret_name": "notion_webhook_verification_token" }
-- トークン平文は絶対に入れない

comment on extension supabase_vault is
  'Phase 7 Notion webhook verification_token storage';

-- service_role のみが呼ぶ: vault へ verification_token を保存し、status を received にする
create or replace function public.store_notion_webhook_verification_token(
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'notion_webhook_verification_token';
  v_existing uuid;
  v_now timestamptz := now();
  v_meta jsonb;
begin
  if p_token is null or length(btrim(p_token)) < 8 then
    raise exception 'invalid_token';
  end if;

  select id into v_existing
  from vault.secrets
  where name = v_name
  limit 1;

  if v_existing is null then
    perform vault.create_secret(p_token, v_name, 'Notion webhook verification_token');
  else
    perform vault.update_secret(v_existing, p_token, v_name, 'Notion webhook verification_token');
  end if;

  v_meta := jsonb_build_object(
    'status', 'received',
    'received_at', v_now,
    'vault_secret_name', v_name
  );

  insert into public.system_settings (key, value, updated_at)
  values ('notion_webhook_setup', v_meta, v_now)
  on conflict (key) do update
    set value = public.system_settings.value
      || v_meta
      || jsonb_build_object(
        'status', 'received',
        'received_at', coalesce(
          public.system_settings.value->>'received_at',
          v_now::text
        ),
        -- 再受信時は received_at を更新
        'received_at', v_now,
        'vault_secret_name', v_name
      ),
        updated_at = v_now;

  -- 平文は返さない
  return jsonb_build_object('status', 'received', 'received_at', v_now);
end $$;

-- service_role のみ: 平文トークン取得(admin reveal 用。アプリ層でログ禁止)
create or replace function public.read_notion_webhook_verification_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'notion_webhook_verification_token';
  v_token text;
begin
  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = v_name
  limit 1;

  return v_token;
end $$;

-- service_role のみ: verified マーク(トークンは消さない。署名検証で引き続き使う)
create or replace function public.mark_notion_webhook_verified()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_meta jsonb;
begin
  v_meta := jsonb_build_object(
    'status', 'verified',
    'verified_at', v_now
  );

  insert into public.system_settings (key, value, updated_at)
  values (
    'notion_webhook_setup',
    jsonb_build_object(
      'status', 'verified',
      'verified_at', v_now,
      'vault_secret_name', 'notion_webhook_verification_token'
    ),
    v_now
  )
  on conflict (key) do update
    set value = public.system_settings.value || v_meta,
        updated_at = v_now;

  return v_meta;
end $$;

revoke all on function public.store_notion_webhook_verification_token(text) from public, anon, authenticated;
revoke all on function public.read_notion_webhook_verification_token() from public, anon, authenticated;
revoke all on function public.mark_notion_webhook_verified() from public, anon, authenticated;

grant execute on function public.store_notion_webhook_verification_token(text) to service_role;
grant execute on function public.read_notion_webhook_verification_token() to service_role;
grant execute on function public.mark_notion_webhook_verified() to service_role;
