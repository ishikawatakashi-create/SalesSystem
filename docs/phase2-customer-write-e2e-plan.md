# Phase 2 顧客write pipeline 実Notionテスト計画

実Notionへ顧客を作成する**前**の検証計画。本ドキュメント時点では未実施。

対象プレフィックス: 表示名 `test:` で始まる顧客を1件のみ使用する。

## 前提

- Phase 1 Notion 9DB / マスタ71件 / snapshot / `NOTION_DS_*` 設定済み
- マイグレーション `20260806130000_phase2_customer_index_phone.sql` をリモート適用済みであること
- 実行アクターは `customer.edit` 権限を持つ `profile_completed` ユーザー
- 秘密情報・個人情報をログに出さない

## 検証手順

1. **Notion顧客ページ作成**  
   `customerCreate` で `displayName=test:customer-e2e-1` を作成。Notion UIでページ存在を確認。

2. **external_id一致**  
   作成レスポンスの `external_id` と Notion `external_id` プロパティが一致。

3. **customer_index反映**  
   `notion_page_id` / `display_name` / `phone` / `phone_normalized` / master IDs / `sync_status=synced` を確認。

4. **write_operations completed**  
   同一 `request_id` の行が `status=completed`、`notion_page_id` 設定済み。

5. **audit_logs作成**  
   `action=customer.create`、`actor_id`、`request_id`、`changed_fields` を確認。

6. **同じrequest_id再実行で重複なし**  
   同一コマンド再実行。Notionページ数が増えない。`pages.create` 相当が走らないこと。

7. **異なる入力+同じrequest_id拒否**  
   `input_hash_mismatch` (`CustomerSyncError`) になること。

8. **顧客更新**  
   表示名・電話等を更新。Notionとindexが一致。

9. **楽観ロック競合拒否**  
   古い `expectedLastEditedTime` で更新し `conflict`。上書きしない。

10. **notion_doneからの再開**  
    監査またはindexを意図的失敗させた後、`notion_done` から再実行して `completed` へ。

11. **external_idによる曖昧失敗復旧**  
    作成応答喪失を模擬(または手動でpendingのまま再実行)。`external_id` 照会で二重作成しない。

12. **最後にテスト顧客をアーカイブ**  
    `isArchived=true` の update。削除は行わない。

## 停止条件

- 上記はマイグレーション本適用後に実施する
- UI実装・Webhook・CSVには進まない
