# Strikingly 問い合わせ取込（Google Apps Script）

SalesSystem Production へ 5 分ごとに Gmail label 付きメールを POST します。  
過去分は手動の `backfillStrikinglyInquiries()` で chunk 取込します。

```
Strikingly → Gmail (label) → Apps Script → POST /api/integrations/inquiries/apps-script
```

Google Cloud Pub/Sub・Gmail OAuth Client・users.watch は使いません。

## 前提

- 問い合わせ受信メールボックスが Gmail / Google Workspace
- SalesSystem Production に `INQUIRY_APPS_SCRIPT_SECRET` が設定済み
- Gmail 側で label / filter を人間が作成済み

## 運用手順（推奨順）

### 1. 通常連携設定

1. Gmail → 設定 → ラベル → `SalesSystem/お問い合わせ` を作成
2. フィルタ作成: Strikingly 問い合わせ通知に一致 → 上記 label を付ける  
   （Apps Script から filter は作りません）
3. [script.google.com](https://script.google.com) で **スタンドアロン** プロジェクトを作成
4. このフォルダの `Code.gs` をそのまま貼り付け
5. プロジェクト設定で `appsscript.json` のタイムゾーンが `Asia/Tokyo` であること（任意）

### 2. Script Properties

「プロジェクトの設定」→「スクリプト プロパティ」:

| 名前 | 説明 |
|---|---|
| `SALES_SYSTEM_ENDPOINT` | `https://sales-system-weld.vercel.app/api/integrations/inquiries/apps-script` |
| `SALES_SYSTEM_INGEST_SECRET` | Vercel の `INQUIRY_APPS_SCRIPT_SECRET` と同じ値 |
| `GMAIL_LABEL` | 任意。未設定時は `SalesSystem/お問い合わせ` |

**secret を Code.gs に書かないこと。**

### 3. checkConfiguration

1. エディタで `checkConfiguration` を実行
2. Google アカウントの権限承認（Gmail 読み取り・外部への接続）
3. ログで `label_exists: true` / `endpoint_set: true` / `secret_set: true` を確認  
   （secret 値そのものは出ません）

> Apps Script / GmailApp の OAuth スコープはプラットフォーム都合で読み取り以外を含む場合があります。  
> **このコードは Gmail 変更 API（既読・削除・label 変更等）を呼びません。**

### 4. setupTrigger

1. `setupTrigger` を実行（5 分ごとの `syncStrikinglyInquiries`）
2. `checkConfiguration` で `trigger_exists: true` を確認  
   **backfill 用 trigger は作りません。**

### 5. 通常 polling 確認

1. Strikingly の test 投稿（本番問い合わせと誤認されない内容）
2. Gmail で label が付くことを確認
3. 最大約 5 分待ち、または `syncStrikinglyInquiries` を手動実行
4. SalesSystem `/inquiries` に 1 件だけ表示されること
5. 同じ実行を再度行い duplicate になること（件数増えない）
6. `/admin/sync` で heartbeat が更新されること

通常 polling は `newer_than:2d` の overlap のみ。  
`Re:` / `Fwd:` や非元通知は skip（inquiry を作らない）。  
plain が欠落する場合は `html_body` を transient 送信（DB 非保存。server で sanitize）。

### 6. backfill 開始（任意・手動のみ）

過去の label 付き Strikingly 通知を取り込む場合のみ:

1. `backfillStrikinglyInquiries` を **明示実行**（自動開始しない）
2. 1 回あたり約 40 message まで処理して停止
3. ログ例: `backfill=running ... processed=... accepted=... duplicate=... skipped=... failed=...`

対象:

- `GMAIL_LABEL` に属する
- 件名/本文が Strikingly 問い合わせ通知らしい（例: 「あなたのサイトにコメントしました」）
- From 単独には依存しない
- server 側 parser でも最終判定。非 Strikingly は insert せず skip

### 7. progress 確認

- `getBackfillStatus` または `checkConfiguration` の `backfill_status`
- 確認項目: `status` / `processed` / `accepted` / `duplicate` / `skipped` / `failed` / `completed`
- 本文・メール・電話・secret はログに出ません

続きがあるときは **もう一度** `backfillStrikinglyInquiries` を実行（Script Properties の cursor から再開）。

### 8. 完了確認

1. ログが `backfill=completed` または `completed: true`
2. `/inquiries` で過去分が **元の受信日時順** で並ぶこと
3. 過去取込は一覧に「過去取込」表示、**新着 badge には含めない**
4. status は勝手に対応済へ変更されない（`new` のまま受信箱に蓄積）
5. 顧客/担当/履歴への自動昇格はしない

完了後にやり直す場合のみ `resetBackfillProgress` → 再度 `backfillStrikinglyInquiries`。

## Gmail 返信下書き（Web App）

1. Script Property に `SALES_SYSTEM_DRAFT_SECRET` を追加（ingest secret とは別）
2. `appsscript.json` / `Code.gs` を最新化
3. 初回実行で **再authorization**（Gmail compose スコープ）
4. デプロイ → ウェブアプリ  
   - 実行ユーザー: 自分  
   - アクセスできるユーザー: 全員（HMAC必須）
5. デプロイ URL を Vercel `INQUIRY_APPS_SCRIPT_DRAFT_URL` へ  
   secret を `INQUIRY_APPS_SCRIPT_DRAFT_SECRET` へ
6. `/inquiries/[id]` で送信元選択 → 「Gmail返信下書きを作成」

`sendEmail` / `reply` 送信は使いません。`createDraftReply` のみ。

## トラブルシュート

| 症状 | 確認 |
|---|---|
| `label_missing` | Gmail に label 名が一致しているか |
| HTTP 401 | secret / 時刻ずれ（端末時刻） |
| HTTP 503 | Vercel に `INQUIRY_APPS_SCRIPT_SECRET` 未設定 |
| 受信なし | filter・label・trigger・`/admin/sync` の heartbeat |
| heartbeat 遅延 | trigger が止まっていないか Apps Script 実行数上限 |
| backfill が進まない | `failed` 増加 → 429/5xx。時間をおいて再実行 |
| badge が増えすぎ | 過去取込は badge 除外。通常 new のみ対象 |
| `failed>0` かつ `local_throw>0` | `Code.gs` が古い（`received_at` の Date 変換不備）の可能性。最新版へ貼り替え |
| `http_401` | secret / 時刻ずれ。secret をむやみに変えず、まず最新 Code.gs を確認 |
| `http_400` / `invalid_payload` | ペイロード shape。最新 Code.gs と Production の整合 |

## ログ方針

`Logger.log` には件数集計のみ。本文・メール・電話・secret は出さない。
