-- Phase 11 transport 変更: Apps Script polling metadata（加算のみ）
-- Pub/Sub / OAuth 用テーブル・Vault RPC は破壊的に削除しない（deprecated）

insert into public.system_settings (key, value, updated_at)
values (
  'inquiry_apps_script',
  jsonb_build_object(
    'integration_mode', 'apps_script_polling',
    'last_heartbeat_at', null,
    'last_ingest_at', null
  ),
  now()
)
on conflict (key) do update
  set value = public.system_settings.value
    || jsonb_build_object('integration_mode', 'apps_script_polling'),
      updated_at = now();

-- 旧 gmail_integration キーが残っていれば mode 注記のみ付与（値破壊しない）
update public.system_settings
set value = value || jsonb_build_object(
  'deprecated_transport', 'pubsub_oauth',
  'replaced_by', 'inquiry_apps_script'
),
    updated_at = now()
where key = 'gmail_integration';

comment on table public.gmail_oauth_states is
  'DEPRECATED: Phase11 Pub/Sub OAuth CSRF states. Unused after Apps Script transport.';
