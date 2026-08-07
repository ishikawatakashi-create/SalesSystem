# 実装計画

各Phaseは「動作確認可能な状態」で完了させる。完了時にそのPhaseの動作確認手順を実施し、テストが通ることを確認してから次へ進む。

改訂履歴:
- 2026-08-05 設計レビュー反映(ジョブ基盤・スケジューラー・分散レート制御をPhase 1へ移動、認証スパイク追加、write_operations等の新規要素反映)。
- 2026-08-07 実装進捗反映: Phase 1・顧客管理・先方担当者管理を完了済みとし、次工程を案件管理とする(作業呼称では先方担当者=Phase 3完了、案件=Phase 4)。
- 2026-08-07 対応履歴・次回アクションを完了(作業呼称Phase 5)。契約・クレーム・Webhook・CSVは後続。
- 2026-08-07 契約・クレーム管理を完了(作業呼称Phase 6)。Webhook・CSV・ダッシュボードは後続。
- 2026-08-07 Notion Webhook受信・Vault検証基盤と admin `/admin/sync` セットアップUIを追加(作業呼称Phase 7)。
- 2026-08-07 Phase 7 Production 実Webhook E2E・同期メトリクス・運用手順を完了。Production endpoint `https://sales-system-weld.vercel.app/api/webhooks/notion`。次工程はCSV・ダッシュボード。
- 2026-08-07 Phase 8 CSV取込・既存データ移行を実装完了。次工程はダッシュボード・全体仕上げ。

## Phase 0: 設計(完了)

`docs/` 配下の9文書を作成・改訂済み。

## Phase 1: 基盤(完了)

**ゴール: 招待されたユーザーがログインでき、権限管理・ジョブ基盤・分散レート制御込みのNotion接続・テスト基盤が動く。**

1. **技術スパイク(最初に実施)**: 認証フローの挙動確認
   - Supabaseの新APIキー(Publishable / Secret)での `@supabase/ssr` 動作確認
   - `inviteUserByEmail` によるメール招待 → パスワード設定 → ログイン
   - Google OAuth(サインアップ無効状態)で招待済みメールのみログインできること
   - **Before User Created Hook** で未招待ユーザーの作成を拒否できること(メール招待フローと干渉しないこと)
   - 実プロジェクトのEmail OTP Expirationと`user_invitations.expires_at`を一致させ、期限切れ後に再招待できること
   - 認証スパイク中は`profile_created`を暫定利用可能とし、未プロビジョニングAuthユーザーは自動削除せず管理者が検知・確認できること
   - 結果を `docs/permissions.md` の認証設計および [auth-spike-results.md](./auth-spike-results.md) へ反映(想定と異なる場合は設計修正)
   - **2026-08-06 暫定完了**: A/B/D/E/F成功。C(Google OAuthブラウザE2E)は本番公開前の確認事項として保留(開発非ブロック)
2. プロジェクト初期化
   - Next.js(App Router, TypeScript strict)+ Tailwind + shadcn/ui、ESLint/Prettier
   - `.env.example`(新APIキー・NOTION_DS_ACTIONS含む)、`README.md` 更新、`server-only` 境界
3. Supabaseスキーマ一式([supabase-schema.md](./supabase-schema.md))
   - 型・app_users・user_invitations・全インデックス(action_index含む)・audit_logs(**改ざん禁止トリガー**)・write_operations・jobs(**排他制御列**)・job_items・sync_errors・webhook_events・import系・saved_searches・recent_views・system_settings・**notion_rate_limiter**
   - RPC: `claim_next_job`(リース回収+failed遷移込み)/ `heartbeat_job`・`complete_job`・`fail_job`(locked_by照合)/ `ingest_webhook_event` / `reserve_notion_slot` / `report_notion_rate_limited` / `current_app_role`
   - **RPC実行権限のREVOKE/GRANT**(システムRPCはバックエンドロールのみ。[supabase-schema.md §8](./supabase-schema.md#rpcdb関数の実行権限))、SECURITY DEFINERの `search_path=''` 規約
   - RLSポリシー一式、pg_trgm / pg_cron / pg_net拡張
   - **2026-08-06**: マイグレーション `20260806120000_phase1_foundation.sql` をリモートへ適用済み。実DB結合テスト(`tests/phase1-remote.integration.test.ts`, `RUN_REMOTE_DB_TESTS=1`)通過。
4. 認証・招待・権限
   - `@supabase/ssr` クライアント3種+middleware
   - ログイン画面(メール+パスワード / Google / パスワード再設定)、auth callback
   - 招待フロー(user_invitations+Before User Created Hook+`provisioning_status` と再試行ジョブ `user_provisioning`)
   - `lib/auth/permissions.ts` + `requireUser` / `requirePermission`
   - 管理画面: ユーザー招待・一覧・権限変更・無効化
   - **認証スパイク暫定完了**(上記1)。Google OAuthブラウザE2Eは本番公開前
5. **ジョブ基盤(Phase 4から前倒し)**
   - `lib/jobs/scheduler.ts`: JobScheduler抽象化
   - **SupabaseCronScheduler(初期採用)**: `pg_cron` + `pg_net` で毎分 `/api/jobs/run` を起動(CRON_SECRET検証)
   - VercelCronScheduler(Vercel Pro以上の場合の代替)を差し替え可能な形で用意
   - ワーカー: `claim_next_job` による排他取得、チャンク実行、heartbeat、リース切れ回収、`attempts`/バックオフ
   - **2026-08-06**: JobScheduler / SupabaseCronScheduler / `/api/jobs/run` / 意味論テストまで実装。実DB適用後に結合確認
6. Notion接続
   - **2026-08-06**: Notionクライアント / setup-notion(plan) / 9DBスキーマ / 顧客コンバーター / staff provisioning(dry-run可) 実装。**`--apply`未実行**
   - `lib/notion/client.ts`: APIバージョン **`2026-03-11`**、429=Retry-After遵守+グローバル停止、500/502/503/504=一時障害リトライ、`in_trash` 対応
   - `scripts/setup-notion.ts`: **9DB作成(external_id等の必須プロパティ含む)**+初期マスタ(**semantic_key / semantic_tags付き**)投入+**標準ビュー作成**+**プロパティIDスナップショット生成・保存**(config JSON+system_settings)
   - `lib/notion/schema.ts` / `converters/`(顧客のみ先行。プロパティID参照、25件超リレーションのページネーション)
7. 共通レイアウト・エラーハンドリング・ロギング
8. テスト基盤: Vitest+最初の単体テスト(permissions / rate-limiter / claim_next_job)、Playwright+ログインE2E

**動作確認**: スパイク項目一式 / 権限別ナビ表示 / ジョブをenqueueして毎分ワーカーが排他実行する / Notion 9DB+ビューが作成されスナップショットが保存される / 監査ログがSecret key経由でも更新・削除できない。

## Phase 2: 顧客管理(完了)

**ゴール: 顧客の検索・閲覧・登録・編集が一気通貫で動き、検索インデックスが機能する。**

1. 正規化ライブラリ `lib/normalize/`+単体テスト — **完了**
2. 書込パイプライン `lib/sync/write-pipeline.ts`(**write_operations+external_idによる冪等化・クラッシュ復旧**、部分失敗のsync_errors記録、楽観ロック)+統合テスト — **完了**
3. 顧客登録・編集(RHF+Zod、masters_cache参照) — **完了**
4. 顧客検索・一覧(検索・フィルタ・URL条件保存・高密度テーブル) — **完了**(列設定・プレビューパネルは後続改善可)
5. 顧客詳細(ヘッダー・基礎情報枠・営業枠、Notion正本取得+短時間キャッシュ) — **完了**
6. 関連アカウント(customer_relations+双方向表示) — **完了**(登録・編集でのrelation検証込み)
7. **先方担当者(=Notion顧客担当者DB / contact_index)**: 登録・編集・無効化・一覧・顧客詳細組込み+氏名変更時のcustomer_index.search_text再構築 — **2026-08-07 完了**(作業呼称Phase 3)
8. 保存済み検索・最近閲覧 — 未着手
9. マイデスク(担当顧客・最近閲覧/更新・新規登録導線。KPI・アクション枠は後続) — 未着手
10. E2E: 顧客検索 / 詳細 / 登録 / 編集 / 表記揺れ検索 — **完了**(表記揺れの網羅は継続改善)

## Phase 3: 営業活動

**ゴール: 案件・対応履歴(複数分類・一括登録)・次回アクション・契約・クレームが動く。**

1. 案件(登録・編集・一覧。status_semanticの解決、顧客見込み金額の自動集計) — **2026-08-07 完了**(作業呼称Phase 4)
2. 対応履歴 — **2026-08-07 完了**(作業呼称Phase 5)
   - 登録・編集・一覧・詳細(複数分類、登録者/最終編集者、**本文はページ本文ブロック+要約プロパティ**、本文ハッシュ監査、本文競合の楽観ロック、物理削除なし)
   - 顧客/案件/担当者詳細への組込み。コンパクト・タイムライン統合表示は後続改善可
3. **次回アクション(次回アクションDB+action_index)** — **2026-08-07 完了**(作業呼称Phase 5)
   - 履歴登録フォームからの連続登録(部分成功明示)、単独作成、完了・取消、本日・期限超過一覧
   - **再計算**: 顧客の最新対応内容・最終対応日、顧客・案件のnext_action / next_action_date(ジョブ+processInline)。顧客.見込み金額は案件側で実装済み
4. 一括履歴登録 — **2026-08-07 完了**(作業呼称Phase 5。行単位独立作成+再試行。大規模ジョブ化は後続可)
5. 契約(専用セクション。契約書URL/ファイル別プロパティ) — **2026-08-07 完了**(作業呼称Phase 6。ファイルuploadは後続可)
6. クレーム(専用セクション。詳細本文は見出し付きページ本文) — **2026-08-07 完了**(作業呼称Phase 6)
7. **顧客詳細「全活動」タイムライン**(対応履歴・案件受注・契約作成・クレーム発生/解決を表示上のみ統合。[ui-guidelines.md](./ui-guidelines.md)) — 未着手
8. マイデスクKPI完成(semantic_keyベースの集計、クリックで条件付き一覧へ) — 未着手
9. ユーザープロフィール画面 — 未着手
10. E2E: 履歴登録 / 複数分類 / 一括登録 / アクション完了 / 案件 — **対応履歴・一括・アクション分は完了**。契約・クレームは未着手

## Phase 4: 管理機能

**ゴール: マスタ・監査ログ・同期管理・CSVが管理画面で完結する。**

1. マスタ管理(種別タブ・追加・編集・並び替え・色・無効化・semantic_key管理は管理者のみ表示。種別自体の追加はコード対応である旨をUIに明記)
2. Notion Webhook(署名検証+**1トランザクションenqueue**(ingest_webhook_event)+後続同期ジョブ+自書込スキップ) — **Production検証済み**(作業呼称Phase 7)
3. Notion削除確認フロー(in_trash検知→delete_pending→管理者確認→除外/復旧) — Webhook経路はPhase 7で実装。管理UI確認フローは後続可
4. 定期整合性確認(日次差分・週次全件+**スキーマ変更検知・派生値再計算検証**) — Phase 7で実装
5. dependency_reindexジョブ(**大量波及の非同期化**) — 案件見込み金額等はPhase 4〜7で実装
6. 同期状況・同期エラー画面 — `/admin/sync` Phase 7
7. 監査ログ画面(絞り込み・差分表示・Notion側変更の制約注記) — 未着手
8. CSVインポート(**Storage直接アップロード**+マッピング+検証+ジョブ実行+再開+**原本30日削除**) — **2026-08-07 完了**(作業呼称Phase 8。`/admin/imports`)
9. CSVエクスポート(**高速=インデックス / 完全=Notion正本の2方式**) — エラーCSVのみPhase 8。全面exportは後続
10. システム設定(スキーマスナップショット表示・書込一時停止等) — 未着手
11. テスト: 重複判定 / idempotency / 同期再試行 / レートリミッター / claim競合、E2E: インポート / エクスポート / 同期エラー再実行 / Notion更新→インデックス反映 — Phase 8でCSV単体・synthetic 10k含む

## Phase 5: 品質改善

**ゴール: 完了条件([requirements.md §11](./requirements.md#11-完了条件初期版))をすべて満たす。**

1. E2E全シナリオ(権限ごとの操作制限・閲覧専用の編集拒否を含む)
2. パフォーマンス(10,000件規模の検索応答、N+1排除)
3. UI調整(密度・導線の実データ確認、空データ・エラー状態)
4. アクセシビリティ(キーボード・フォーカス・コントラスト)
5. 同期リカバリー運用テスト(Webhook停止→整合性確認で回復、部分失敗→再実行、ワーカークラッシュ→リース回収)
6. セキュリティ最終確認(Secret key非露出、RLS、監査トリガー、Webhook署名、CSVインジェクション、Storage統制)
7. 運用ドキュメント(README / docs/operations.md: 招待・マスタ・同期エラー・原本削除失敗・監査ログ保持の運用)

## 進め方の原則

- 各Phase完了時に完了条件との対応を確認し、動作確認結果を記録する。
- 仮データのみで「完成」としない。Phase 2以降は実際のNotionワークスペースに対する動作確認を伴う。
- 型エラー・リンターエラーを残さない。`any` の使用はレビューで正当化が必要。
- 本計画からの逸脱(要件の削減・延期)は理由を明記して承認を得る。
