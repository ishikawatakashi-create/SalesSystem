# お問い合わせ連携（Phase 11）

改訂: 2026-08-08

## 概要

Strikingly の問い合わせフォームは変更せず、通知メールを Gmail / Google Workspace 経由で受け取り、SalesSystem の「お問い合わせ受信箱」へ取り込む。

```
Strikingly フォーム
  → 通知メール
  → Gmail（専用 label）
  → Gmail API users.watch
  → Google Cloud Pub/Sub
  → POST /api/webhooks/gmail
  → durable ingest（jobs）
  → history.list / messages.get
  → inquiries（Supabase）
```

お問い合わせは顧客になる前の入口キューであり、Notion 業務 DB には追加しない。正式な顧客・担当者・対応履歴へ昇格するときだけ既存 write pipeline を使う。

## 権限

| 操作 | admin | a | b | viewer |
|---|:-:|:-:|:-:|:-:|
| inquiry.view | ○ | ○ | ○ | ○ |
| inquiry.edit | ○ | ○ | ○ | × |
| Gmail 連携設定（settings.manage） | ○ | × | × | × |

## OAuth / scopes

- CRM ログイン用 Supabase Google OAuth とは **別 integration**
- scope: `https://www.googleapis.com/auth/gmail.readonly` のみ
- アプリはメールの削除・既読化・移動・label 変更・返信を行わない
- refresh token は Supabase Vault（`gmail_oauth_refresh_token`）
- `system_settings.gmail_integration` にはメタデータのみ（平文トークン禁止）

## label / filter

1. 人間が Gmail UI で label（例: `SalesSystem/お問い合わせ`）を作成
2. Strikingly 通知をその label へ付けるフィルタを作成
3. `/admin/integrations/gmail` で label を選択してから取り込み開始

label 未選択のまま全メール取り込みはしない。

## watch / reconciliation

- `users.watch` の historyId / expiration を保存
- 日次メンテで `gmail_watch_renew` / `gmail_reconciliation` を enqueue
- historyId 失効時は label 付きメッセージの期間限定再走査（full mailbox 禁止）

## Pub/Sub

- endpoint: `POST /api/webhooks/gmail`
- authenticated push の OIDC JWT を検証（iss / aud / email / email_verified）
- JWT・メール本文はログしない
- request 内では Gmail messages.get を大量実行しない（job へ移譲）

## parser

- Reply-To / From / Subject / plain / HTML
- 未知テンプレートは破棄せず `parse_status=warning` で受信箱へ
- raw MIME 全文は DB 保存しない

## status

| コード | 表示 |
|---|---|
| new | 未確認 |
| in_progress | 対応中 |
| done | 対応済 |
| no_action | 対応不要 |

表示名比較で判定しない。

## triage / 変換

- 担当割当（new → in_progress 可）
- 対応不要（削除しない・reopen 可）
- 既存顧客候補提示（自動 link 禁止）
- 新規顧客 / 先方担当者 / 対応履歴化は既存 pipeline + 明示操作

## 障害復旧

| 症状 | 対応 |
|---|---|
| refresh token invalid | 管理画面で再接続 |
| watch expired | 警告 + renew 再試行 |
| history invalid | reconciliation |
| Pub/Sub 失敗 | sync_errors |
| message fetch 一時失敗 | job retry |
| parse warning | 問い合わせは受信済み |

## secret rotation

1. Google Cloud で OAuth client secret をローテーション
2. Vercel Production の `GMAIL_OAUTH_CLIENT_*` を更新（値はチャットに貼らない）
3. 必要なら Gmail を再接続して refresh token を再保存

## 環境変数（名前のみ）

`GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` / `GMAIL_OAUTH_REDIRECT_URI` /
`GCP_PROJECT_ID` / `GMAIL_PUBSUB_TOPIC` / `GMAIL_PUBSUB_AUDIENCE` /
`GMAIL_PUBSUB_SERVICE_ACCOUNT` / `NEXT_PUBLIC_APP_URL`
