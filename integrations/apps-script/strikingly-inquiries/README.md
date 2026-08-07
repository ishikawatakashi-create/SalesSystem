# Strikingly 問い合わせ取込（Google Apps Script）

SalesSystem Production へ 5 分ごとに Gmail label 付きメールを POST します。

```
Strikingly → Gmail (label) → Apps Script (5分) → POST /api/integrations/inquiries/apps-script
```

Google Cloud Pub/Sub・Gmail OAuth Client・users.watch は使いません。

## 前提

- 問い合わせ受信メールボックスが Gmail / Google Workspace
- SalesSystem Production に `INQUIRY_APPS_SCRIPT_SECRET` が設定済み
- Gmail 側で label / filter を人間が作成済み

## 1. Gmail: label と filter

1. Gmail → 設定 → ラベル → `SalesSystem/お問い合わせ` を作成
2. フィルタ作成: Strikingly 問い合わせ通知に一致 → 上記 label を付ける  
   （Apps Script から filter は作りません）

## 2. Apps Script プロジェクト

1. [script.google.com](https://script.google.com) で **スタンドアロン** プロジェクトを作成
2. このフォルダの `Code.gs` をそのまま貼り付け
3. プロジェクト設定で `appsscript.json` のタイムゾーンが `Asia/Tokyo` であること（任意）

## 3. Script Properties

「プロジェクトの設定」→「スクリプト プロパティ」:

| 名前 | 説明 |
|---|---|
| `SALES_SYSTEM_ENDPOINT` | `https://sales-system-weld.vercel.app/api/integrations/inquiries/apps-script` |
| `SALES_SYSTEM_INGEST_SECRET` | Vercel の `INQUIRY_APPS_SCRIPT_SECRET` と同じ値 |
| `GMAIL_LABEL` | 任意。未設定時は `SalesSystem/お問い合わせ` |

**secret を Code.gs に書かないこと。**

## 4. 初回 authorization

1. エディタで `checkConfiguration` を実行
2. Google アカウントの権限承認（Gmail 読み取り・外部への接続）
3. ログで `label_exists: true` / `endpoint_set: true` / `secret_set: true` を確認  
   （secret 値そのものは出ません）

> Apps Script / GmailApp の OAuth スコープはプラットフォーム都合で読み取り以外を含む場合があります。  
> **このコードは Gmail 変更 API（既読・削除・label 変更等）を呼びません。**

## 5. Trigger

1. `setupTrigger` を実行（5 分ごとの `syncStrikinglyInquiries`）
2. `checkConfiguration` で `trigger_exists: true` を確認

## 6. テスト

1. Strikingly の test 投稿（本番問い合わせと誤認されない内容）
2. Gmail で label が付くことを確認
3. 最大約 5 分待ち、またはエディタで `syncStrikinglyInquiries` を手動実行
4. SalesSystem `/inquiries` に 1 件だけ表示されること
5. 同じ実行を再度行い duplicate になること（件数増えない）

## トラブルシュート

| 症状 | 確認 |
|---|---|
| `label_missing` | Gmail に label 名が一致しているか |
| HTTP 401 | secret / 時刻ずれ（端末時刻） |
| HTTP 503 | Vercel に `INQUIRY_APPS_SCRIPT_SECRET` 未設定 |
| 受信なし | filter・label・trigger・`/admin/sync` の heartbeat |
| heartbeat 遅延 | trigger が止まっていないか Apps Script 実行数上限 |

## ログ方針

`Logger.log` には件数集計のみ。本文・メール・電話・secret は出さない。
