# 営業管理システム

社内向けBtoB営業管理Webアプリ。分散していた顧客情報(Excel / スプレッドシート / Notion)を集約し、顧客・案件・対応履歴・契約・クレームを一元管理する。

- **正本データはNotion**(Single Source of Truth、9データベース)。Supabaseは認証・権限・検索インデックス・監査ログ・同期状態・ジョブ管理・分散レート制御のみを担う。
- 技術スタック: Next.js(App Router / TypeScript)+ Supabase(Auth / PostgreSQL / Storage)+ Notion API(バージョン `2026-03-11`)+ Tailwind CSS。

## 現在の状態

**Phase 11(お問い合わせ受信箱 / Apps Script 取込)実装済み。** Gmail label + Apps Script 設定は人間操作後。詳細は [docs/inquiry-integration.md](./docs/inquiry-integration.md)。

- Production: `https://sales-system-weld.vercel.app`
- 主要URL: `/` / `/inquiries` / `/customers` / `/deals` / `/admin/sync` / `/admin/imports`
- 取込: `POST /api/integrations/inquiries/apps-script`（HMAC）
- Apps Script: `integrations/apps-script/strikingly-inquiries/`
- 実装済み: Phase 1〜11（請求・返信送信・AIは非対象）
- 運用: [docs/operations-runbook.md](./docs/operations-runbook.md) / [docs/release-checklist.md](./docs/release-checklist.md)

### Auth Admin APIの注意(実測)

- `auth.admin.createUser` は Before User Created Hook を**迂回**する。公開 `signUp` では未招待が拒否されるが、Admin API直呼びでは作成できてしまう。
- アプリコードは `src/lib/auth/admin-api.ts` 経由のみとし、作成前に管理者権限・pending招待・期限・メール一致を検証する。初回管理者bootstrapは active admin 0件かつ明示メールに限定する。
- Secret key / 仮パスワード / トークンはログへ出さない。操作は `audit_logs` へ記録する。

## 設計文書

実装・レビュー・コード補完時は必ず以下に準拠すること。

| 文書 | 内容 |
|---|---|
| [docs/requirements.md](./docs/requirements.md) | 要件定義・完了条件・非対象範囲・設計上の仮定・禁止事項 |
| [docs/architecture.md](./docs/architecture.md) | システム構成・SSoT境界・技術選定・ディレクトリ構成・環境変数 |
| [docs/notion-schema.md](./docs/notion-schema.md) | Notionデータベース設計(9DB・プロパティ・リレーション・初期データ) |
| [docs/supabase-schema.md](./docs/supabase-schema.md) | Supabaseテーブル・検索インデックス・正規化規則・RLS |
| [docs/permissions.md](./docs/permissions.md) | 認証設計・4権限(管理者/A/B/閲覧専用)のマトリクス |
| [docs/auth-spike-results.md](./docs/auth-spike-results.md) | 認証技術スパイク結果・本番公開前確認事項・テストユーザー片付け |
| [docs/sync-design.md](./docs/sync-design.md) | Notion/Supabase同期(書込パイプライン・Webhook・削除確認・整合性確認) |
| [docs/csv-import-design.md](./docs/csv-import-design.md) | CSVインポート(10ステップ・重複判定・ジョブ)・エクスポート |
| [docs/ui-guidelines.md](./docs/ui-guidelines.md) | デザイントークン・UI原則・禁止パターン・画面別ワイヤーフレーム |
| [docs/implementation-plan.md](./docs/implementation-plan.md) | Phase 実装タスク分解と完了基準 |
| [docs/inquiry-integration.md](./docs/inquiry-integration.md) | Strikingly→Gmail→Pub/Sub→受信箱 |
| [docs/operations-runbook.md](./docs/operations-runbook.md) | 日次運用・招待・同期・CSV・秘密ローテーション手順 |
| [docs/release-checklist.md](./docs/release-checklist.md) | リリース前・直後の確認項目 |

## 開発コマンド

```bash
npm install        # 依存インストール
npm run dev        # 開発サーバー(http://localhost:3000)
npm run test       # 単体テスト(Vitest)
npm run typecheck  # 型チェック
npm run lint       # ESLint
npm run build      # 本番ビルド
```

## セットアップ(人間による作業が必要)

1. **Supabaseプロジェクト作成**
   - `.env.example` をコピーして `.env.local` を作成し、`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`(sb_publishable_...)/ `SUPABASE_SECRET_KEY`(sb_secret_...)を設定する。JWT系レガシーキー(anon / service_role)は使用しない。
   - Authentication → Sign In / Providers → Emailの **Email OTP Expiration** を確認し、同じ秒数を `SUPABASE_EMAIL_OTP_EXPIRY_SECONDS` に設定する。公式既定値は1時間だが、実プロジェクトの値を推測してはならない。招待リンクとDB招待の期限はこの値で一致させる。
2. **マイグレーション適用**
   - `supabase/migrations/` のSQLを順に適用する(Supabase CLIの `supabase db push`、またはダッシュボードのSQL Editor)。
3. **Before User Created Hook の有効化**
   - ダッシュボードの Authentication → Hooks → Before User Created で、Postgres関数 `public.hook_before_user_created` を設定する。**未設定の場合、未招待ユーザーのAuthアカウント作成を防げない**(アプリ側のプロビジョニング照合が最後の防御線になる)。
4. **Google OAuth**
   - Google Cloud ConsoleでOAuthクライアントを作成し、SupabaseのAuthentication → Providers → Googleに Client ID / Secret を設定する。リダイレクトURLはSupabaseが表示するもの(`https://<project>.supabase.co/auth/v1/callback`)を登録する。
5. **Auth URL設定**
   - Authentication → URL Configuration で Site URL(本番URL)とRedirect URLs(`http://localhost:3000/auth/callback` 等)を設定する。
   - Authentication → Email Templates → Invite userのリンクを、`token_hash`と`type=invite`を`/auth/callback`へ渡すSSR用テンプレートに設定する。例: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite`。実際のSite URL/許可済みRedirect URLと一致させる。
6. **SMTP設定(推奨)**
   - 招待・パスワード再設定メールを確実に届けるため、本番運用前にカスタムSMTPを設定する(Supabase既定のメール送信はレート制限が厳しい)。
7. **最初の管理者の招待(bootstrap)**
   - 通常の招待は管理者権限が必要。初回のみ `AUTH_BOOTSTRAP_ADMIN_EMAIL` に明示したメールかつ active admin が0件のとき、`src/lib/auth/admin-api.ts` のbootstrap経由で作成する。
   - Dashboardの生Admin APIや `createUser` 直呼びは使わない(Hook迂回のため)。期限付きの `user_invitations` を先に用意する。

```sql
insert into public.user_invitations (
  email, normalized_email, display_name, role, expires_at
)
values (
  'admin@example.com',
  'admin@example.com',
  '管理者名',
  'admin',
  now() + make_interval(secs => <Email OTP Expirationの実設定秒数>)
);
```

   - 実際のSQLでは列一覧に `expires_at` も指定すること。プレースホルダーをそのまま実行しない。

## 認証スパイク中の暫定運用

- `profile_created`: Authと`app_users`の作成が完了した状態。Notion未接続の認証スパイク中は利用可能とする。
- `completed`: Notion自社担当者ページ作成と`notion_staff_page_id`保存まで完了した最終状態。Notion接続時に`user_provisioning`ジョブで`profile_created`をバックフィルする。
- Authに存在して`app_users`に存在しないユーザーは管理画面で検知する。初期版では自動削除せず、人間が招待状態と認証ログを確認する。削除機能・自動削除ジョブは別途承認なしに追加しない。

## Notionセットアップ(人間による作業)

1. Notionで親ページ(例: 「営業管理システム」)を作成し、Internal Integrationを接続する。
2. `.env.local` に `NOTION_TOKEN` と `NOTION_PARENT_PAGE_ID`(またはCLI引数)を設定する。トークンをコミットしない。
3. **まずplanのみ**: `npx tsx scripts/setup-notion.ts`(`--apply`なし)。作成予定のDB・プロパティ・relation・初期マスタ・ビューを確認する。
4. 合意後にのみ `npx tsx scripts/setup-notion.ts --apply` を実行する。同名DBの自動再利用や破壊的`--reset`は実装しない。
5. 出力された `NOTION_DS_*` を `.env.local` へ反映する。プロパティIDスナップショットは `system_settings` とローカル生成ファイル(Git管理外)へ保存される。
