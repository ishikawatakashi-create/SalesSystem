# 運用ランブック

本番運用の手順書。**秘密情報(トークン・パスワード・署名鍵)は本書に書かない。** 値は Vercel / Supabase の環境変数・Vault を正とする。

関連: [release-checklist.md](./release-checklist.md) / [sync-design.md](./sync-design.md) / [csv-import-design.md](./csv-import-design.md) / [permissions.md](./permissions.md)

---

## 1. 日次オペレーションチェックリスト

- [ ] `/admin/sync` で Webhook 受信・ジョブ失敗・`sync_errors` 未解決件を確認
- [ ] `storage_cleanup_failed` が残っていないか確認(CSV原本削除失敗)
- [ ] 期限超過アクション / 未解決クレームが異常に増えていないか(マイデスクKPI)
- [ ] Notion / Vercel / Supabase の障害・メンテナンス告知がないか確認
- [ ] 前日の重要CSV取込が完了/partial success で止まっていないか(`/admin/imports`)

---

## 2. ユーザー招待・ロール

1. `/admin/users` でメール・表示名・ロールを指定して招待(`user.manage` = admin)
2. 招待メールのリンクからパスワード設定(または Google OAuth、招待済みメールのみ)
3. ロール変更・無効化も同画面。無効化はハード削除しない(`is_active=false`)
4. 招待期限は Supabase Auth の Email OTP Expiration に合わせる([permissions.md](./permissions.md))
5. Auth にいて `app_users` にいないユーザーは管理画面で検知し、自動削除しない

---

## 3. Notion 接続

1. Internal Integration を親ページに接続し、`NOTION_TOKEN` / `NOTION_DS_*` を環境変数へ設定
2. 初回・再セットアップは `npx tsx scripts/setup-notion.ts`(まず plan、合意後のみ `--apply`)
3. プロパティIDスナップショットは `system_settings` に保存。スキーマ変更後は再スナップショット
4. 自社担当者ページは `user_provisioning` ジョブでバックフィル

---

## 4. Webhook(検証済み / 再作成)

- Production endpoint: `/api/webhooks/notion`(署名検証 + `ingest_webhook_event`)
- **verified 済み subscription** がある場合、安易に削除しない。再作成すると verification やり直し
- 再作成が必要なとき: Notion 側で subscription を作り直し → verification challenge 成功を確認 → `/admin/sync` で受信が流れることを確認
- 自書込スキップ・idempotency は [sync-design.md](./sync-design.md) に従う

---

## 5. 整合性確認(reconciliation)

- 日次差分・週次全件の整合性ジョブが `/admin/sync` から監視できる
- Webhook 停止・取りこぼし後は整合性確認でインデックスを回復させる
- スキーマ変更検知が発火したら、Notion プロパティ変更の有無を確認しスナップショットを更新

---

## 6. スキーマドリフト

1. `/admin/sync` または整合性ジョブのスキーマ検知を確認
2. Notion DB のプロパティ追加・リネーム・削除を特定
3. アプリの converter / スナップショットを更新し、必要ならマイグレーション
4. 書込一時停止が必要な重大変更は管理者判断で実施

---

## 7. `sync_errors` トリアージ

| stage / 症状 | 初動 |
|---|---|
| Notion 一時障害(5xx/429) | 自動再試行を待ち、続くならレート・障害状況を確認 |
| バリデーション / 必須欠落 | 対象ページを Notion で修正し再実行 |
| `storage_cleanup_failed` | Storage 権限・path・原本メタを確認し手動再実行または修正 |
| 削除 pending | Notion `in_trash` → 管理者が除外/復旧を確定 |
| 部分失敗(インデックス未更新) | 対象の同期ジョブを再実行。二重作成に注意(write_operations) |

個人情報・CSV本文・トークンをログに貼らない。

---

## 8. ジョブ失敗

1. `/admin/sync` で `jobs` の failed / attempts を確認
2. リース切れはワーカーが回収する。長時間 `running` は heartbeat 停止を疑う
3. `/api/jobs/run` は `CRON_SECRET` 付きで cron から起動。手動再実行も同エンドポイント想定
4. 同一 `idempotency_key` の再enqueueは冪等。無闇にキーを変えない

---

## 9. CSV インポート

- 権限: `csv.import`(admin + A)、画面 `/admin/imports`
- 推奨順: 顧客 → 担当者 → 案件 → 対応履歴 → アクション → 契約 → クレーム
- partial success: 成功行は rollback しない。失敗行のみ再実行
- 詳細: [csv-import-design.md](./csv-import-design.md)

---

## 10. Storage クリーンアップ(原本30日削除)

- ワーカー(`/api/jobs/run`)起動時に `ensureDailyMaintenanceJobs()` が日次で `storage_cleanup` を enqueue
- idempotency_key: `storage_cleanup:YYYY-MM-DD`(UTC日付)
- 失敗は `sync_errors.stage=storage_cleanup_failed`。放置禁止
- CSV本文・storage path 詳細を監査ログに出さない方針を守る

---

## 11. マイグレーション / Vercel / Supabase デプロイ

1. `supabase/migrations/` を順適用(`supabase db push` または SQL Editor)
2. Before User Created Hook が有効なことを確認
3. Vercel に環境変数を反映してからデプロイ(Preview と Production を取り違えない)
4. デプロイ後: ログイン → マイデスク → `/admin/sync` の疎通
5. Webhook URL が Production を向いていることを確認

---

## 12. インシデント初動

1. **影響範囲**: ログイン不可 / 書込不可 / 同期停止 / データ不整合
2. **止血**: 必要なら書込停止・CSV取込停止・Webhook 一時無効(管理者判断)
3. **観測**: Vercel ログ、Supabase ログ、`/admin/sync`、Notion ステータス
4. **復旧**: 一時障害なら待機+再試行。データ不整合は reconciliation。誤書込は Notion 正本を基準に訂正
5. **事後**: 原因・再発防止を短いメモで残す(秘密は書かない)

---

## 13. 秘密情報ローテーション(手順のみ・値は書かない)

| 対象 | 手順概要 |
|---|---|
| Notion token | Integration で再発行 → Vercel/ローカルの `NOTION_TOKEN` を更新 → 旧トークン無効化 → 疎通確認 |
| `CRON_SECRET` | 新値を生成 → Vercel と cron 呼び出し側を同時更新 → 旧値無効 → `/api/jobs/run` 認証確認 |
| Webhook secret | Notion subscription / アプリ検証鍵を手順どおり更新 → verification → 受信テスト。verified subscription の扱い注意 |

ローテーション中は二重稼働時間を短くし、完了後に旧秘密を破棄する。Git に値をコミットしない。

---

## 14. バックアップ(概要)

- **Supabase**: マネージドバックアップ(プランに依存)。Point-in-time 等はダッシュボードで確認。アプリ独自のフルダンプ運用は初期版対象外
- **Notion**: ワークスペースのエクスポート・Notion側の保持ポリシーに依存。正本は Notion のため、破壊的操作前に対象DBのエクスポートを検討
- **CSV原本**: Storage に最大30日。恒久アーカイブが必要なら取込前に組織側で保管
