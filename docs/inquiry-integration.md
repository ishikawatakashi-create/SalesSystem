# お問い合わせ連携（Phase 11）

改訂: 2026-08-08（Apps Script polling へ変更）

## 概要

Strikingly の問い合わせフォームは変更せず、通知メールを Gmail label 経由で受け取り、**Google Apps Script の 5 分ポーリング**で SalesSystem へ取り込みます。

```
Strikingly フォーム
  → 通知メール
  → Gmail（専用 label）
  → Google Apps Script（5分ごと）
  → POST /api/integrations/inquiries/apps-script（HMAC）
  → Strikingly parser
  → inquiries（Supabase）
```

お問い合わせは顧客になる前の入口キューであり、Notion 業務 DB には追加しない。正式な顧客・担当者・対応履歴へ昇格するときだけ既存 write pipeline を使う。

## 採用しなかった設計

初期実装では Gmail API + Google Cloud Pub/Sub + 専用 OAuth を検討したが、**1 日数件規模には過剰**なため採用しない。

廃止（コード削除済み / DB は破壊せず残置）:

- Pub/Sub push / OIDC
- Gmail `users.watch` / history.list / reconciliation ジョブ
- Gmail 専用 OAuth Client / refresh token Vault 利用経路
- `GMAIL_PUBSUB_*` / `GCP_PROJECT_ID` / `GMAIL_OAUTH_*` 環境変数

残置（破壊的削除しない）:

- `gmail_oauth_states` テーブル
- Vault RPC（`store/read/clear_gmail_oauth_refresh_token`）
- `system_settings.gmail_integration`（`deprecated_transport` 注記）
- `ingest_gmail_pubsub_event` RPC

## 権限

| 操作 | admin | a | b | viewer |
|---|:-:|:-:|:-:|:-:|
| inquiry.view | ○ | ○ | ○ | ○ |
| inquiry.edit | ○ | ○ | ○ | × |
| 取込設定表示（settings.manage / sync.manage） | ○ | × | × | × |

## Apps Script transport

- 成果物: `integrations/apps-script/strikingly-inquiries/`
- label 既定: `SalesSystem/お問い合わせ`
- 検索 window: `newer_than:2d`（重複は server dedupe）
- Gmail 変更操作はコード上使用しない（既読・削除・label 変更禁止）
- ログは件数のみ（本文・PII・secret 禁止）

### 認証（HMAC）

Script Properties:

- `SALES_SYSTEM_ENDPOINT`
- `SALES_SYSTEM_INGEST_SECRET`

Request headers:

- `X-SalesSystem-Timestamp`
- `X-SalesSystem-Signature` = hex(HMAC-SHA256(timestamp + "." + rawBody, secret))

Server:

- env `INQUIRY_APPS_SCRIPT_SECRET`
- timestamp 許容 ±5 分
- constant-time 比較
- secret / signature / 本文をログしない

### Heartbeat

各 poll で `{ "type": "heartbeat" }` を POST。  
`system_settings.inquiry_apps_script.last_heartbeat_at` を更新。  
`/admin/sync` で正常 / 遅延を表示。

### 過去 backfill（手動）

- Apps Script: `backfillStrikinglyInquiries()`（自動開始しない）
- chunk（約 40 message / 実行）+ Script Properties cursor で再開
- payload: `historical_import: true`、`received_at` は元メール日時
- Strikingly と確定できないメールは skip（問い合わせにしない）
- `source_message_id` dedupe により polling / 再実行と競合しても 1 件
- DB: `inquiries.historical_import`。status は `new` のまま
- nav / mydesk 新着 badge は `historical_import = false` のみ集計
- 自動で顧客・Contact・Activity・Notion 投入はしない
- **全期間完了は必須ではない。** 必要十分なら `stopBackfillByUser()` で停止
  - `status=stopped_by_user`（または chunk 間の `paused`）
  - cursor / processed・accepted・duplicate・skipped・failed を保持
  - `completed=true` にはしない
  - 通常 5 分 polling へ影響しない
  - 再開時は既存 cursor から継続

## Parser / business

Apps Script は transport + 軽い候補判定（`html_body` 可・DB非保存）。  
Strikingly 解析・返信除外・再parse（`parser_version`）・割当・顧客化は SalesSystem 側。  
`ingest_classification=ignored_non_source` は一覧/badge 対象外（物理削除しない）。

## status

| コード | 表示 |
|---|---|
| new | 未確認 |
| in_progress | 対応中 |
| done | 対応済 |
| no_action | 対応不要 |

## 障害復旧

| 症状 | 対応 |
|---|---|
| heartbeat 遅延 | Apps Script trigger / 実行ログ確認 |
| 401 `invalid_signature` / `stale_timestamp` | secret 不一致・端末時刻・古い Code.gs |
| 400 `invalid_payload` | ペイロード shape |
| 503 | Vercel secret 未設定 |
| label_missing | Gmail label 作成 |
| duplicate | 正常（no-op） |
| Apps Script `local_throw` | 多くは `getDate().toISOString` 不備。最新 Code.gs の `toIso8601_` を使用 |

## Gmail 返信下書き（Web App）

mailto / ブラウザ compose ではなく、Apps Script Web App 経由で **下書きのみ**作成する。

```
SalesSystem（inquiry.edit）
  → 署名付き envelope（HMAC）
  → Apps Script doPost
  → GmailApp.getMessageById + createDraftReply
```

- Script Property: `SALES_SYSTEM_DRAFT_SECRET`（ingest secret とは別）
- Server env: `INQUIRY_APPS_SCRIPT_DRAFT_URL` / `INQUIRY_APPS_SCRIPT_DRAFT_SECRET`
- 送信元は primary + `GmailApp.getAliases()` のみ（自由入力不可）
- `sendEmail` / `reply` / Gmail API send は使わない
- 下書き作成だけでは status を `done` にしない
- 一覧では担当・状態を inline 変更可能（既存 Server Action / audit）

## 環境変数（名前のみ）

- `INQUIRY_APPS_SCRIPT_SECRET`（server-only）
- `INQUIRY_APPS_SCRIPT_DRAFT_URL`（server-only）
- `INQUIRY_APPS_SCRIPT_DRAFT_SECRET`（server-only）
- `NEXT_PUBLIC_APP_URL`（endpoint 組み立て用・任意）
