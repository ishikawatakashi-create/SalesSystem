# リリースチェックリスト

本番デプロイ前・直後の確認項目。秘密情報は記録しない。運用詳細は [operations-runbook.md](./operations-runbook.md)。

## デプロイ前

- [ ] `npm run typecheck` / `npm run lint` / `npm run test` が通る
- [ ] 未適用の `supabase/migrations/` がない
- [ ] `.env.example` と本番環境変数のキーが揃っている(値はダッシュボードで確認)
- [ ] Notion DS ID・Webhook endpoint・`CRON_SECRET` が Production 向け
- [ ] Before User Created Hook が有効
- [ ] 破壊的 Notion 操作・`--apply` の必要性を確認済み
- [ ] AI連携など非対象機能を誤って含めていない

## デプロイ直後(スモーク)

- [ ] `/login` → 招待済みユーザーでログイン
- [ ] `/`(マイデスク)が表示される
- [ ] `/search?q=...` が動く
- [ ] 顧客詳細・案件詳細が開ける
- [ ] 権限ロールでナビの管理リンク表示が正しい
- [ ] `/admin/sync`(admin)でメトリクスが読める
- [ ] Webhook が verified のまま受信できる(テスト更新1件)
- [ ] `/api/jobs/run` が cron 経由で動く(ジョブが消化される)
- [ ] CSV取込画面(`/admin/imports`)が権限者のみ開ける

## 同期・保管

- [ ] `storage_cleanup` の日次 enqueue が想定どおり(または翌日確認でよい)
- [ ] `sync_errors` に新規の未解決が急増していない
- [ ] スキーマドリフト警告が出ていない

## ロールバック判断

- ログイン不可・広範な書込失敗・Webhook 全滅が続く場合は前リビジョンへ戻し、環境変数の食い違いを疑う
- DBマイグレーションを戻す場合は別途計画。安易な down は禁止
