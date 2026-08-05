# 営業管理システム

社内向けBtoB営業管理Webアプリ。分散していた顧客情報(Excel / スプレッドシート / Notion)を集約し、顧客・案件・対応履歴・契約・クレームを一元管理する。

- **正本データはNotion**(Single Source of Truth、9データベース)。Supabaseは認証・権限・検索インデックス・監査ログ・同期状態・ジョブ管理・分散レート制御のみを担う。
- 技術スタック: Next.js(App Router / TypeScript)+ Supabase(Auth / PostgreSQL / Storage)+ Notion API(バージョン `2026-03-11`)+ Tailwind CSS。

## 現在の状態

**Phase 1 実装中(認証技術スパイクのローカル実装まで完了)。** 進行は [docs/implementation-plan.md](./docs/implementation-plan.md) に従う。

- 実装済み: Next.jsプロジェクト基盤 / 認証基盤マイグレーション(`supabase/migrations/`)/ Supabaseクライアント3種+proxy / 権限チェック(`requireUser` / `requirePermission`)/ ログイン・招待・パスワード設定UI / 管理者のユーザー招待画面 / 単体テスト
- 未完了: 実SupabaseプロジェクトとGoogle OAuthの接続確認(下記セットアップが必要)、Notion接続、ジョブ基盤

## 設計文書

実装・レビュー・コード補完時は必ず以下に準拠すること。

| 文書 | 内容 |
|---|---|
| [docs/requirements.md](./docs/requirements.md) | 要件定義・完了条件・非対象範囲・設計上の仮定・禁止事項 |
| [docs/architecture.md](./docs/architecture.md) | システム構成・SSoT境界・技術選定・ディレクトリ構成・環境変数 |
| [docs/notion-schema.md](./docs/notion-schema.md) | Notionデータベース設計(9DB・プロパティ・リレーション・初期データ) |
| [docs/supabase-schema.md](./docs/supabase-schema.md) | Supabaseテーブル・検索インデックス・正規化規則・RLS |
| [docs/permissions.md](./docs/permissions.md) | 認証設計・4権限(管理者/A/B/閲覧専用)のマトリクス |
| [docs/sync-design.md](./docs/sync-design.md) | Notion/Supabase同期(書込パイプライン・Webhook・削除確認・整合性確認) |
| [docs/csv-import-design.md](./docs/csv-import-design.md) | CSVインポート(10ステップ・重複判定・ジョブ)・エクスポート |
| [docs/ui-guidelines.md](./docs/ui-guidelines.md) | デザイントークン・UI原則・禁止パターン・画面別ワイヤーフレーム |
| [docs/implementation-plan.md](./docs/implementation-plan.md) | Phase 1〜5の実装タスク分解と完了基準 |

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
2. **マイグレーション適用**
   - `supabase/migrations/` のSQLを順に適用する(Supabase CLIの `supabase db push`、またはダッシュボードのSQL Editor)。
3. **Before User Created Hook の有効化**
   - ダッシュボードの Authentication → Hooks → Before User Created で、Postgres関数 `public.hook_before_user_created` を設定する。**未設定の場合、未招待ユーザーのAuthアカウント作成を防げない**(アプリ側のプロビジョニング照合が最後の防御線になる)。
4. **Google OAuth**
   - Google Cloud ConsoleでOAuthクライアントを作成し、SupabaseのAuthentication → Providers → Googleに Client ID / Secret を設定する。リダイレクトURLはSupabaseが表示するもの(`https://<project>.supabase.co/auth/v1/callback`)を登録する。
5. **Auth URL設定**
   - Authentication → URL Configuration で Site URL(本番URL)とRedirect URLs(`http://localhost:3000/auth/callback` 等)を設定する。
6. **SMTP設定(推奨)**
   - 招待・パスワード再設定メールを確実に届けるため、本番運用前にカスタムSMTPを設定する(Supabase既定のメール送信はレート制限が厳しい)。
7. **最初の管理者の投入**
   - 招待は管理者権限が必要なため、最初の1人はSQLで直接投入する:

```sql
insert into public.user_invitations (email, normalized_email, display_name, role)
values ('admin@example.com', 'admin@example.com', '管理者名', 'admin');
```

   - その後、ログイン画面の「パスワードをお忘れの方」ではなく、ダッシュボードから招待メールを送るか、Googleでログインする(招待済みのため Before User Created Hook を通過できる)。

Notionインテグレーション・9DB作成(`scripts/setup-notion.ts`)の手順は、Phase 1のNotion接続ステップ実装時に追記する。
