# Supabaseテーブル設計

Supabaseは**正本ではない**。認証・権限・検索インデックス・監査ログ・同期状態・ジョブ管理・分散レート制御・CSV原本保管のみを担う([architecture.md の SSoT境界](./architecture.md#3-ssot境界))。

改訂履歴: 2026-08-05 設計レビュー反映(write_operations、user_invitations、action_index、notion_rate_limiter、ジョブ排他列+RPC、監査トリガー、新APIキー方針、import_jobs拡張)。

- すべてUTCで保存(`timestamptz`)。表示はJST。
- 拡張: `pg_trgm`(類似検索)、`pgcrypto`(UUID)、`pg_cron` + `pg_net`(ワーカー起動。[architecture.md §5](./architecture.md#5-ジョブ実行アーキテクチャ))。
- マイグレーションは `supabase/migrations/` にSQLで管理。

## 1. 型定義

```sql
create type app_role as enum ('admin', 'a', 'b', 'viewer');
create type sync_status as enum ('synced', 'pending', 'error', 'delete_pending', 'excluded');
create type job_status as enum ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled');
create type provisioning_status as enum ('pending', 'auth_created', 'profile_created', 'completed', 'failed');
create type write_op_status as enum ('pending', 'notion_done', 'completed', 'failed');
create type invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type import_row_status as enum (
  'pending', 'valid_new', 'valid_update', 'duplicate', 'invalid',
  'skipped', 'importing', 'imported', 'import_failed'
);
```

## 2. ユーザー・権限・招待

### user_invitations(招待の正)

| 列 | 型 | 備考 |
|---|---|---|
| id | uuid PK | |
| email | text not null | 入力そのまま |
| normalized_email | text not null | 小文字化・トリム済み。Google OAuth時の照合キー |
| display_name | text not null | |
| role | app_role not null | |
| **status** | invitation_status not null default 'pending' | pending / accepted / revoked / expired |
| invited_by | uuid → app_users.id | |
| expires_at | timestamptz not null(既定値なし) | Supabase AuthのEmail OTP Expirationと同じ秒数を発行時に明示 |
| accepted_at | timestamptz | 受諾(初回ログイン成立)時刻 |
| revoked_at | timestamptz | 取消時刻 |
| created_at | timestamptz | |

```sql
-- 有効(pending)な招待はメールアドレスごとに1件のみ。
-- expires_atは部分インデックス条件に使わない(now()は使用不可のため)。
create unique index user_invitations_pending_email_uniq
  on user_invitations (normalized_email)
  where status = 'pending';
```

- **期限の正**: 招待リンクの実期限はSupabase Authの **Email OTP Expiration**。実プロジェクトの設定秒数を`SUPABASE_EMAIL_OTP_EXPIRY_SECONDS`へ明示し、アプリは同じ秒数から`expires_at`を算出する。公式既定値だけを根拠に実設定を推測しない。
- **期限切れ処理**: 定期ジョブ(既存の `storage_cleanup` 等と同じ日次バッチ)が `status='pending' and expires_at < now()` の行を `status='expired'` へ更新する。招待の有効性判定(Before User Created Hook等)は「`status='pending'` かつ `expires_at >= now()`」の両方で行い、ジョブの実行遅延に依存しない。再招待時も対象メールの期限超過pendingを先に`expired`へ遷移するため、日次ジョブを待たず再発行できる。
- 期限切れ・取消済みのメールアドレスには再招待(新しいpending行の作成)が可能。

- **未招待ユーザーの作成拒否**: Supabase Authの **Before User Created Hook** で、公式ペイロードの`event.user.email`だけを参照し、`user_invitations`(`status='pending'` かつ `expires_at >= now()`)と照合する。メール欠落時はフェイルクローズし、`record.email`や`claims.email`へフォールバックしない。一致しなければ作成を拒否するため、Google OAuth経由でも未招待アカウントは `auth.users` 自体が作られない。関数はマイグレーション所有者(`postgres`)の`SECURITY DEFINER set search_path=''`として`public.user_invitations`を参照するため、同テーブルのRLSを迂回して招待を照合できる。EXECUTEは`supabase_auth_admin`だけへ許可し、`public`/`anon`/`authenticated`からREVOKEする。

### app_users

| 列 | 型 | 備考 |
|---|---|---|
| id | uuid PK | `auth.users.id` を参照(FK, on delete restrict) |
| email | text not null | |
| display_name | text not null | |
| role | app_role not null default 'viewer' | |
| department_role | text | 所属・役割 |
| is_active | boolean not null default true | |
| **provisioning_status** | provisioning_status not null default 'pending' | 下記の部分失敗管理 |
| provisioning_error | text | |
| notion_staff_page_id | text unique | 自社担当者DBの対応ページID |
| invitation_id | uuid → user_invitations.id | |
| created_at / updated_at | timestamptz | |

- **プロビジョニングの部分失敗対策**: 招待受諾時の「Auth作成 → app_users作成 → Notion自社担当者ページ作成」は複数システムにまたがり原子的でない。Auth作成後の`app_users`作成と招待の`accepted`遷移は`accept_invitation_and_provision` RPCで原子的に実行し、状態を`profile_created`とする。認証スパイク中は`profile_created`を暫定的に利用可能とする。Notion接続後は**再試行ジョブ(kind=`user_provisioning`)**が自社担当者ページを作成し、`notion_staff_page_id`保存と同時に`completed`へ遷移する。既存`profile_created`もバックフィル対象とする。`pending` / `auth_created` / `failed`は利用不可。
- **未プロビジョニングAuthユーザー**: `auth.users`に存在して`app_users`に存在しないユーザーは管理画面で検知し、人間が確認する。初期版では自動削除せず、自動削除ジョブは別途承認なしに実装しない。

## 3. 検索インデックス(Notionキャッシュ)

全インデックステーブル共通の同期管理列:

```sql
notion_page_id        text primary key,
external_id           uuid unique,   -- アプリ発行UUID(Notionのexternal_idプロパティと一致)
content_hash          text,
notion_last_edited_at timestamptz,
sync_status           sync_status not null default 'pending',
sync_error_message    text,
last_synced_at        timestamptz,
created_at            timestamptz not null default now(),
updated_at            timestamptz not null default now()
```

### customer_index(顧客)

列構成は従来どおり(表示名 / 法人名 / 事業所名 / 住所系 / phone_normalized / email / 代表者名 / 各マスタ参照ID配列 / staff_user_ids / latest_activity_summary / last_activity_at / next_action / next_action_date / expected_amount / is_archived / search_text / search_text_kana)+共通列。

- `next_action` / `next_action_date` / `latest_activity_summary` / `last_activity_at` は**派生値**であり、`action_index` / `activity_index` から再計算される([sync-design.md §7](./sync-design.md#7-派生データの再計算dependency_reindex))。

```sql
create index on customer_index using gin (search_text gin_trgm_ops);
create index on customer_index using gin (search_text_kana gin_trgm_ops);
create index on customer_index (phone_normalized);
create index on customer_index (prefecture);
create index on customer_index (sales_status_id);
create index on customer_index (next_action_date);
create index on customer_index (last_activity_at);
create index on customer_index using gin (tag_ids);
create index on customer_index using gin (business_category_ids);
create index on customer_index using gin (staff_user_ids);
```

正規化規則(search_text生成)は従来どおり: NFKC / 法人格統一 / 空白除去 / 英字小文字化 / 異体字写像(髙→高等)/ かな統一 / 電話番号数字のみ。

### customer_relations(関連アカウントの逆引き)

`(from_page_id, to_page_id)` PK。同期時に再構築。

### contact_index / deal_index / activity_index / contract_index / complaint_index

従来どおりの列+共通列(external_id追加)。補足:

- `activity_index`: 本文はキャッシュしない。`title` / `summary`(要約)/ `body_hash`(本文ハッシュ。監査・整合性確認用)を持つ。
- `deal_index`: `status_semantic`(masters_cacheから解決したsemantic_key)を持ち、受注集計は `status_semantic = 'won'` で行う。

### action_index(次回アクション・新規)

マイデスクの「本日対応予定」「期限超過」の**正式な参照元**。

| 列 | 型 | 備考 |
|---|---|---|
| notion_page_id ほか共通列 | | |
| title | text not null | アクション内容 |
| customer_page_id | text not null | |
| deal_page_id | text | |
| activity_page_id | text | 元対応履歴 |
| assignee_user_id | uuid | 自社担当者(app_users.id) |
| due_date | date | |
| status_id | text | マスタ参照 |
| is_open | boolean not null | semantic_key=openから導出。部分インデックス用 |
| priority_id | text | |
| completed_at | timestamptz | |
| created_by | uuid / created_by_name text | |

```sql
create index on action_index (assignee_user_id, due_date) where is_open;
create index on action_index (customer_page_id) where is_open;
create index on action_index (due_date) where is_open;
```

### masters_cache(営業マスタ)

| 列 | 型 | 備考 |
|---|---|---|
| notion_page_id | text PK | |
| master_type | text not null | |
| name | text not null | |
| **semantic_key** | text | **状態系マスタ用**(案件ステータス・契約状態・クレーム対応状況・アクション状態等)。won / lost / active / completed / open / done / cancelled 等。`(master_type, semantic_key)` の部分ユニークインデックス(semantic_keyがnullでない行のみ)で**種別内一意**。状態遷移・集計の判定はこの列で行う |
| **semantic_tags** | text[] not null default '{}' | **分類系マスタ用**(対応履歴分類等)。複数項目が同じ意味を共有できる(例: 訪問=`{meeting,visit}`、オンライン商談=`{meeting,online}`)。一意制約なし。商談件数は `'meeting' = any(semantic_tags)` で判定。GINインデックス |
| sort_order | numeric | |
| color | text | |
| is_active | boolean not null default true | |
| applicable_category_ids | text[] | |
| 共通同期列 | | |

## 4. 書込整合性: write_operations(新規)

すべてのNotion作成・更新操作を記録し、冪等化とクラッシュ復旧を保証する([sync-design.md §1](./sync-design.md))。

| 列 | 型 | 備考 |
|---|---|---|
| request_id | uuid PK | クライアント/ジョブが発行 |
| entity_type | text not null | customer / activity / deal / ... |
| operation | text not null | `create` / `update` |
| **external_id** | uuid not null | 作成時: 新規ページに付与するUUID。更新時: 対象のexternal_id |
| input_hash | text not null | 正規化済み入力のSHA-256(同一request_idで異なる入力が来た場合の検知) |
| status | write_op_status not null default 'pending' | pending → notion_done → completed |
| notion_page_id | text | Notion作成/更新成功後に記録 |
| **recovery_payload** | jsonb | 復旧に必要な情報。更新操作: 期待プロパティ値・期待本文ハッシュ・期待リレーション。ページ本文更新: `old_block_ids` / `new_block_ids` / `body_version`([sync-design.md §1](./sync-design.md)) |
| actor_id | uuid | |
| started_at | timestamptz not null default now() | |
| completed_at | timestamptz | |
| error | text | |

```sql
create index on write_operations (external_id);
create index on write_operations (status, started_at);
```

- **作成の復旧**: Notion作成成功後・Supabase更新前にクラッシュしても、`pending` のまま残った操作は `external_id` でNotionをデータソースクエリ(`external_id equals`)して存在確認でき、二重作成せずに再開できる。
- **更新の復旧**: `pending` / `notion_done` の更新操作は、Notionの現在値を取得して `recovery_payload` の期待値(プロパティ・本文ハッシュ・リレーション)と比較し、反映済みなら監査・インデックス更新から再開、未反映ならNotion更新を再実行する。作成と更新で復旧手順を明確に分ける([sync-design.md §1](./sync-design.md))。
- CSV行・一括登録は**決定的external_id**(UUIDv5: namespace=ジョブID、name=行番号等)を生成する([csv-import-design.md](./csv-import-design.md))。
- 古い完了レコードは定期削除(**90日**)対象。ただし監査ログは別途保存(初期版では自動削除なし)。

## 5. 監査ログ

### audit_logs(追記専用)

列構成は従来どおり(id / actor_id / actor_name / action / entity_type / notion_page_id / changed_fields jsonb / operation_source / request_id / batch_id / created_at)。

**改ざん防止はRLS/REVOKEに加えてPostgreSQLトリガーで強制する。Secret key(RLSバイパス)経由でも通常の更新・削除はできない。**

```sql
create function forbid_audit_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end $$;

create trigger audit_logs_no_update before update on audit_logs
  for each row execute function forbid_audit_mutation();
create trigger audit_logs_no_delete before delete on audit_logs
  for each row execute function forbid_audit_mutation();

revoke update, delete on audit_logs from authenticated, anon;
```

- **初期版では監査ログの自動削除は行わない**(恒久保存)。参考: データ保持期間はCSV原本=30日、write_operations=90日、監査ログ=自動削除なし。
- 保持期限・アーカイブが将来必要になった場合は、通常経路とは分離した**専用運用**(DB管理者がメンテナンスウィンドウでトリガーを一時無効化し、アーカイブ先へ移してから削除。手順書化+実施記録)とする。アプリコードからは一切行わない。
- `changed_fields` には変更項目のみ保存。長文(ページ本文)は全文ではなく本文ハッシュ・要約・文字数を記録([notion-schema.md §10](./notion-schema.md#10-長文の扱いページ本文ブロック))。

## 6. 同期・ジョブ

### jobs(排他制御列を含む)

| 列 | 型 | 備考 |
|---|---|---|
| id | uuid PK | |
| kind | text not null | `csv_import` / `webhook_sync` / `reconciliation` / `sync_repair` / `bulk_activity` / `export_full` / `dependency_reindex` / `user_provisioning` / `storage_cleanup` |
| priority | int not null default 100 | 小さいほど優先。UI起因(対話的操作の後続処理)は高優先(例: 10)、バルクは低優先(例: 100) |
| status | job_status not null default 'queued' | |
| payload | jsonb | 機微情報を含めない |
| progress_done / progress_total | int | |
| cursor | jsonb | チャンク再開位置 |
| idempotency_key | text unique | 二重enqueue防止 |
| **locked_by** | text | ワーカーID(インスタンスID+起動時刻) |
| **locked_at** | timestamptz | |
| **lease_expires_at** | timestamptz | リース期限。超過ジョブは他ワーカーが回収 |
| **heartbeat_at** | timestamptz | 処理中の生存報告 |
| **attempts** | int not null default 0 | |
| **max_attempts** | int not null default 5 | 超過で `failed` |
| **next_run_at** | timestamptz not null default now() | 遅延実行・バックオフ再試行 |
| error_message | text | |
| created_by | uuid | |
| created_at / started_at / finished_at / updated_at | timestamptz | |

### 原子的ジョブ取得RPC(リース回収込み)

claim対象は「`queued` で実行時刻到来」**または**「`running` のままリース切れ(クラッシュ回収)」とし、いずれも `attempts < max_attempts` を条件に含める。回収時に上限へ達しているジョブは `failed` へ遷移させる。

```sql
create function public.claim_next_job(p_worker_id text, p_lease_seconds int default 300)
returns setof public.jobs
security definer set search_path = ''
language plpgsql as $$
declare j public.jobs;
begin
  -- 1) リース切れかつ再試行上限超過のジョブをfailedへ確定
  update public.jobs set
    status = 'failed',
    error_message = coalesce(error_message, 'lease expired; max_attempts exceeded'),
    finished_at = now()
  where status = 'running'
    and lease_expires_at < now()
    and attempts >= max_attempts;

  -- 2) claim対象: queued(実行時刻到来) または running(リース切れ)。attempts上限内のみ
  select * into j from public.jobs
    where attempts < max_attempts
      and (
        (status = 'queued'  and next_run_at <= now())
        or
        (status = 'running' and lease_expires_at < now())
      )
    order by priority, created_at
    limit 1
    for update skip locked;
  if not found then return; end if;

  update public.jobs set
    status = 'running',
    locked_by = p_worker_id,
    locked_at = now(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    heartbeat_at = now(),
    attempts = attempts + 1,
    started_at = coalesce(started_at, now())
  where id = j.id;
  return query select * from public.jobs where id = j.id;
end $$;
```

### ハートビートRPC(ワーカー照合+リース有効性検査)

**`locked_by` が一致し、かつ自分のリースがまだ有効(`lease_expires_at > now()`)なワーカーだけ**がリースを延長できる。リース切れ後の旧ワーカーは、ジョブが別ワーカーへ回収されたか否かに関わらず、**heartbeat・完了報告・失敗報告を一切行えない**。

```sql
create function public.heartbeat_job(p_job_id uuid, p_worker_id text, p_lease_seconds int default 300)
returns boolean  -- falseなら自分のリースは失効済み。後続処理を即時中断すること
security definer set search_path = ''
language sql as $$
  update public.jobs set
    heartbeat_at = now(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = p_job_id
    and locked_by = p_worker_id
    and status = 'running'
    and lease_expires_at > now()
  returning true;
$$;
```

- 完了・失敗報告RPC(`complete_job` / `fail_job`)も同一の3条件(`locked_by = p_worker_id` / `status='running'` / **`lease_expires_at > now()`**)を必須とする。
- **falseが返ったワーカーは後続処理(Notion送信・インデックス更新・結果書込)を即時中断する**。ワーカー実装はNotion送信等の外部作用の直前にheartbeat結果を確認する。
- `fail_job` は `attempts < max_attempts` なら `status='queued'`+`next_run_at=now()+バックオフ` で再試行を予約し、上限到達なら `failed` にする。
- **heartbeat間隔はリース期間より十分短くする**(規約: heartbeat間隔 ≤ リース期間の1/3。既定: リース300秒・heartbeat60秒)。この規約は単体テストで担保する(ワーカー設定値の検証+リース切れ後のheartbeatがfalseを返すことのテスト)。

### job_items

従来どおり(job_id / seq / status / payload / result / error_message / attempts / idempotency_key)。

### sync_errors

従来どおり+stage候補に `schema_mismatch`(Notionスキーマ変更検知)、`derived_recalc`(派生値再計算警告)、`storage_cleanup_failed` を追加。

### webhook_events

従来どおり(イベントIDをPKに重複排除)。**イベント保存とジョブenqueueは単一RPC(`ingest_webhook_event`)内の1トランザクションで実行**し、「イベントは保存されたがジョブが積まれない」欠落を防ぐ([sync-design.md §2](./sync-design.md))。

## 7. 分散レートリミッター: notion_rate_limiter(新規)

Notion APIのレート制限(平均3req/s)を、**サーバレスの複数インスタンス・全経路(UI / CSV / Webhook / 整合性確認)にまたがって保証**するための単一行テーブル+RPC。プロセスメモリ内のキューは補助(同一インスタンス内の平滑化)にとどめ、全体保証はこちらで行う。

```sql
create table notion_rate_limiter (
  id int primary key default 1 check (id = 1),  -- 単一行
  next_slot_at timestamptz not null default now(),
  blocked_until timestamptz,           -- 429受信時のグローバル停止期限
  min_interval_ms int not null default 350  -- 約2.8req/s
);
```

### 利用規約(全経路共通)

1. **各リクエストの直前に1枠だけ予約する。** 1ワーカーが複数の将来枠をまとめて予約してはならない(429発生時に無効な予約が積み上がり、`Retry-After` を破る原因になるため)。
2. **bulk処理(CSV・Webhook後続・整合性確認)のNotion送信並列数は1**とする(ジョブハンドラー内で直列送信)。
3. 予約時刻まで待機した後、**送信直前に `blocked_until` を再確認**する(軽量なselect)。予約後に別リクエストが429を受けて `blocked_until` が延びていた場合は、その時刻まで追加待機してから再予約する。これにより**予約済みリクエストもRetry-Afterを破らない**。
4. 待機が長すぎる場合(例: 5秒超)のUI起因リクエストは、ユーザーへ「混雑中」を表示するか後続ジョブ化する。

### RPC: 送信枠の予約(1枠ずつ)

```sql
create function public.reserve_notion_slot(p_priority text default 'bulk')
returns timestamptz  -- この時刻まで待ってから送信してよい
security definer set search_path = ''
language plpgsql as $$
declare slot timestamptz;
begin
  -- 単一行をロックして直列化
  update public.notion_rate_limiter set
    next_slot_at = greatest(now(), next_slot_at, coalesce(blocked_until, now()))
                   + make_interval(secs => min_interval_ms / 1000.0
                        * case when p_priority = 'interactive' then 1 else 2 end)
  where id = 1
  returning next_slot_at into slot;
  return slot;
end $$;
```

- 呼び出し側(`lib/notion/rate-limiter.ts`)は返却時刻まで待機し、`blocked_until` を再確認してから送信する。**すべてのNotionリクエストはこのRPCを経由する。**
- **本設計は厳密な優先キューではない。** `interactive` と `bulk` の間隔係数(1倍/2倍)は「**bulk処理による対話的操作の圧迫を抑制する**」ためのものであり、UI起因リクエストの優先実行を保証するものではない(予約は到着順)。厳密な優先制御・公平性が必要になった場合は、予約待ち行列を持つ **`notion_request_queue` テーブル方式**へ拡張できる余地を残す(レートリミッターのインターフェースは変えずに実装を差し替え)。

### RPC: 429受信時のグローバル停止

```sql
create function public.report_notion_rate_limited(p_retry_after_seconds int)
returns void
security definer set search_path = ''
language sql as $$
  update public.notion_rate_limiter
    set blocked_until = greatest(coalesce(blocked_until, now()),
                                 now() + make_interval(secs => p_retry_after_seconds))
  where id = 1;
$$;
```

- 429を受けたインスタンスがこれを呼ぶと、**全インスタンス・全経路が `blocked_until` まで新規送信を停止**する(`Retry-After` の遵守)。予約済みで待機中のリクエストも送信直前の再確認(利用規約3)で停止に従う。

## 8. RLSとAPIキーの権限方針

### APIキー(2026年時点のSupabase公式方針)

- レガシー `anon` / `service_role` キーは2026年末に廃止予定のため使用しない。
- **Publishable key(`sb_publishable_...`)**: ブラウザ用。単体では低権限で、ユーザーJWTと組み合わせてRLSが適用される。
- **Secret key(`sb_secret_...`)**: サーバー用。**RLSをバイパスする。** ブラウザからの使用はUser-Agent判定で401拒否される。用途別に複数発行・個別ローテーション可能。

### 2系統のアクセスの分離

| 系統 | 認証 | RLS | 用途 |
|---|---|---|---|
| 利用者操作(読み取り) | Publishable key+ユーザーJWT | **適用される** | ブラウザからのインデックス検索・閲覧、saved_searches / recent_views の読み書き |
| システム操作 | Secret key | **バイパスされる** | サーバーの書込パイプライン・ワーカー・Webhook処理・RPC実行 |

**重要**: Notionへの更新・Secret key経由のSupabase書込はRLSでは守られない。これらの防御は以下で行う。

1. サーバー側の認証+権限チェック(`requireUser` / `requirePermission`。[permissions.md](./permissions.md))
2. Zodによる入力検証
3. write_operationsによる冪等化
4. 監査ログ(トリガーで改ざん防止)

RLSは「利用者JWT経路で権限外データに触れさせない」ための防壁であり、単独で全体を守る仕組みではないことを設計上明示する。

### テーブル別ポリシー

```sql
create function public.current_app_role() returns public.app_role
language sql stable
security definer set search_path = ''
as $$
  select role from public.app_users where id = auth.uid() and is_active
$$;

revoke execute on function public.current_app_role() from public, anon;
grant  execute on function public.current_app_role() to authenticated, service_role;
```

| テーブル | select(利用者JWT) | insert/update/delete(利用者JWT) |
|---|---|---|
| app_users | 認証済み全員(最小列のビュー経由) | 不可(システム操作のみ) |
| user_invitations | adminのみ | 不可 |
| 各index / masters_cache / customer_relations / action_index | 認証済み+`current_app_role() is not null` | 不可 |
| audit_logs | `current_app_role() in ('admin','a')` | 不可(update/deleteはトリガーでも禁止) |
| write_operations / jobs / job_items / sync_errors / webhook_events / notion_rate_limiter | adminのみ(import系ジョブは作成者本人も) | 不可 |
| import_jobs / import_rows | admin+作成者本人(role in ('admin','a')) | 不可 |
| saved_searches | 所有者本人+is_shared=trueは全員 | 所有者本人(利用者JWT書込の例外) |
| recent_views | 本人のみ | 本人のみ(同上) |
| system_settings | adminのみ | 不可 |

### RPC・DB関数の実行権限

PostgreSQLの関数は既定で `PUBLIC` にEXECUTEが付与されるため、**システムRPCは明示的にREVOKEし、Secret keyで使用されるバックエンドロール(`service_role` 相当のロール。以下「バックエンドロール」)だけにGRANTする**。利用者JWT(authenticated)から実行できるのは必要最小限の関数のみ。

```sql
-- 例(全システムRPCに適用)
revoke execute on function public.claim_next_job(text, int) from public, anon, authenticated;
grant  execute on function public.claim_next_job(text, int) to service_role;
```

#### 実行権限マトリクス

| 関数 | anon | authenticated | バックエンドロール(Secret key) |
|---|:-:|:-:|:-:|
| claim_next_job | × | × | ○ |
| heartbeat_job / complete_job / fail_job | × | × | ○ |
| ingest_webhook_event | × | × | ○ |
| reserve_notion_slot | × | × | ○ |
| report_notion_rate_limited | × | × | ○ |
| current_app_role | × | ○(RLSポリシーから参照) | ○ |

#### SECURITY DEFINER関数の規約

- すべてのSECURITY DEFINER関数は **`set search_path = ''`** を指定し、**テーブル・関数名をスキーマ修飾**(`public.jobs` 等)する(search_path汚染によるオブジェクト差し替え攻撃の防止)。
- SECURITY DEFINERは必要な関数(`current_app_role` のようにRLSポリシーから他テーブルを参照するもの、システムRPC)に限定し、それ以外はINVOKERとする。
- 新しいRPCを追加する際は、本マトリクスへの追記とREVOKE/GRANTのマイグレーション同梱をレビュー必須事項とする。

## 9. その他のテーブル

### system_settings

| 列 | 型 | 備考 |
|---|---|---|
| key | text PK | 例: `notion_schema_snapshot` / `export_columns_default` |
| value | jsonb not null | |
| updated_by / updated_at | | |

- Notionプロパティ ID スナップショット([notion-schema.md §11](./notion-schema.md#11-プロパティid方式とスキーマ変更検知))の実行環境での正。
- 旧設計の「受注ステータスのページID指定」は**semantic_keyへ置き換え**たため不要。

### import_jobs(CSV。列を拡張)

| 列 | 型 | 備考 |
|---|---|---|
| id | uuid PK | |
| job_id | uuid FK → jobs | |
| file_name | text | |
| **storage_path** | text not null | Storage private bucket上のパス |
| **file_size** | bigint | |
| **sha256** | text | アップロード後にサーバーが検証・記録 |
| **expires_at** | timestamptz not null | 原本の保持期限(作成から30日) |
| **deleted_at** | timestamptz | 原本削除完了時刻 |
| encoding / row_count / column_mapping / status / summary / created_by / created_at / updated_at | | 従来どおり |

### import_rows

従来どおり+`external_id uuid`(決定的生成。UUIDv5(import_job_id, row_number))。

### saved_searches / recent_views

従来どおり。

## 10. 集計(マイデスクKPI)

- 本日対応予定・期限超過・直近アクション: **action_index が正式な参照元**(`is_open` + `due_date` + `assignee_user_id`)
- 今月の対応件数: `activity_index`(created_by + activity_at)
- 今月の商談件数: `activity_index` のうち、分類マスタの **`semantic_tags` に `meeting` を含む**もの(`'meeting' = any(semantic_tags)`)
- 受注件数・受注金額: `deal_index` の `status_semantic = 'won'`(状態系semantic_key)
- 営業ステータス別件数 / 事業区分別案件状況: `customer_index` / `deal_index` のGROUP BY

初期版はオンデマンド集計で足りる想定。性能問題が出た場合のみ集計キャッシュを追加する。
