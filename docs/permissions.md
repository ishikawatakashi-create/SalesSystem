# 権限設計

改訂履歴: 2026-08-05 設計レビュー反映(Secret keyのRLSバイパス前提の整理、user_invitations、Before User Created Hook、provisioning_status)。2026-08-06 認証技術スパイク暫定完了([auth-spike-results.md](./auth-spike-results.md)。Google OAuthブラウザE2Eは本番公開前確認事項)。2026-08-06 Auth Admin `createUser` がHookを迂回することを実測し、server-onlyラッパー集約方針を追記。2026-08-07 マイデスク/検索の全ロール利用と「自分の案件」=`deal_index.staff_user_ids` 含む `app_users.id` を追記。

## 1. 権限の基本方針

- 権限は4段階: **管理者(admin) / A権限(a) / B権限(b) / 閲覧専用(viewer)**。雇用形態を示す権限名は使用しない。
- 一般公開の自由登録は不可。管理者が招待したユーザーのみ利用できる。
- 権限制御は必ず3層で実施する。ただし各層の守備範囲が異なることを正しく理解する。
  1. **UI**: 権限のない操作のボタン・メニューを非表示または無効化(利便性のため。防御はしない)
  2. **サーバー**: すべてのServer Action / Route Handlerの冒頭で `requireUser()` + `requirePermission(action)` を通過。**Notionへの更新、およびSecret key(`sb_secret_...`)経由のSupabase書込はRLSでは守られないため、この層+Zod検証+監査ログ+冪等化(write_operations)が実質的な防御線である**
  3. **DB**: Supabase RLS([supabase-schema.md §8](./supabase-schema.md#8-rlsとapiキーの権限方針))。**利用者JWT(Publishable key)経路の読み取り操作**に適用される防壁。Secret keyはRLSをバイパスするため、システム操作はこの層に依存しない
- 権限マトリクスの単一情報源はコード上 `src/lib/auth/permissions.ts` とし、本書と常に一致させる(乖離したらレビューで却下)。

## 2. 権限マトリクス

○=可、×=不可

| 操作 | 管理者 | A権限 | B権限 | 閲覧専用 |
|---|:-:|:-:|:-:|:-:|
| **閲覧** | | | | |
| 全顧客閲覧 | ○ | ○ | ○ | ○ |
| 顧客詳細・案件・対応履歴・契約・クレーム閲覧 | ○ | ○ | ○ | ○ |
| お問い合わせ閲覧 | ○ | ○ | ○ | ○ |
| 営業リスト / Prospect 閲覧 | ○ | ○ | ○ | ○ |
| マイデスク・検索・保存済み検索(個人) | ○ | ○ | ○ | ○ |
| **登録・編集** | | | | |
| お問い合わせ振分け・紐付け・変換 | ○ | ○ | ○ | × |
| Prospect 編集・stage・単一担当・DNC | ○ | ○ | ○ | × |
| 営業リスト管理 | ○ | ○ | × | × |
| Prospect CSV取込 | ○ | ○ | × | × |
| Prospect 一括割当 | ○ | ○ | × | × |
| 顧客登録・編集・アーカイブ | ○ | ○ | ○ | × |
| 顧客担当者登録・編集・無効化 | ○ | ○ | ○ | × |
| 案件登録・編集 | ○ | ○ | ○ | × |
| 対応履歴登録・編集(削除は全員不可) | ○ | ○ | ○ | × |
| 次回アクション登録・編集・完了・取消 | ○ | ○ | ○ | × |
| 契約登録・編集 | ○ | ○ | ○ | × |
| クレーム登録・編集 | ○ | ○ | ○ | × |
| **一括操作** | | | | |
| 複数顧客への対応履歴一括登録 | ○ | ○ | ○ | × |
| 一括更新(ステータス・担当者等の一括変更) | ○ | ○ | × | × |
| CSVインポート | ○ | ○ | × | × |
| CSVエクスポート | ○ | ○ | × | × |
| **監査・同期** | | | | |
| 監査ログ閲覧 | ○ | ○ | × | × |
| 同期状況閲覧・同期エラー再実行 | ○ | × | × | × |
| Notion削除確認(除外/復旧の確定) | ○ | × | × | × |
| **管理** | | | | |
| マスタ管理(追加・編集・並替・無効化) | ○ | × | × | × |
| ユーザー管理(招待・無効化) | ○ | × | × | × |
| 権限管理(ロール変更) | ○ | × | × | × |
| システム設定 | ○ | × | × | × |
| Gmail連携設定(お問い合わせ受信) | ○ | × | × | × |

補足:

- 「複数顧客への対応履歴一括登録」は通常の履歴登録の延長としてB権限にも許可する(9.3の一括登録要件)。「一括更新」(既存データの一括変更)とは区別する。
- 対応履歴の**削除は管理者を含む全ロールで不可**(アプリに削除機能を実装しない)。
- 無効化されたユーザー(`is_active = false`)はロールに関わらず全操作を拒否し、ログイン後は案内画面のみ表示する。
- **マイデスク(`/`)・グローバル検索(`/search`)**: `customer.view` 相当で全ロール(admin/a/b/viewer)が利用可能。ナビ・Server側とも閲覧系権限に従う。
- **マイデスク「自分の案件」**: `deal_index.staff_user_ids` にログイン中ユーザーの `app_users.id` が含まれる進行中・保留案件。Notion自社担当者ページIDではなくアプリユーザーIDで判定する。

## 3. 実装仕様

### permissions.ts(単一情報源)

```ts
// src/lib/auth/permissions.ts の概形
export const PERMISSIONS = {
  'customer.view':        ['admin', 'a', 'b', 'viewer'],
  'customer.edit':        ['admin', 'a', 'b'],
  'contact.edit':         ['admin', 'a', 'b'],
  'deal.edit':            ['admin', 'a', 'b'],
  'activity.edit':        ['admin', 'a', 'b'],
  'activity.bulk_create': ['admin', 'a', 'b'],
  'action.edit':          ['admin', 'a', 'b'],
  'contract.edit':        ['admin', 'a', 'b'],
  'complaint.edit':       ['admin', 'a', 'b'],
  'inquiry.view':         ['admin', 'a', 'b', 'viewer'],
  'inquiry.edit':         ['admin', 'a', 'b'],
  'prospect.view':        ['admin', 'a', 'b', 'viewer'],
  'prospect.edit':        ['admin', 'a', 'b'],
  'prospect.import':      ['admin', 'a'],
  'prospect.assign':      ['admin', 'a'],
  'prospect.manage_lists':['admin', 'a'],
  'bulk.update':          ['admin', 'a'],
  'csv.import':           ['admin', 'a'],
  'csv.export':           ['admin', 'a'],
  'audit.view':           ['admin', 'a'],
  'sync.manage':          ['admin'],
  'master.manage':        ['admin'],
  'user.manage':          ['admin'],
  'settings.manage':      ['admin'],
} as const satisfies Record<string, readonly AppRole[]>;
```

### サーバー側チェック

```ts
// 全Server Action / Route Handlerの冒頭で必須
const user = await requireUser();            // 未認証・無効ユーザーは即座に拒否
await requirePermission(user, 'customer.edit'); // 権限外は403相当のエラー
```

- `requireUser()` は `supabase.auth.getUser()` でセッションを検証し(`getSession()` 不使用)、`app_users` の `is_active` を確認する。
- 権限拒否はエラーレスポンスとし、監査上必要な場合(管理系操作の試行)はログへ記録する。
- APIレベルの権限確認はUIの表示制御とは独立して必ず行う(UI制御だけで済ませることを禁止)。

### middleware

- `/login` `/auth/*` 以外は認証必須。未認証は `/login` へリダイレクト。
- `/admin/*` は追加で `role = admin` を確認(A権限がアクセスできる `/admin/import` `/admin/export` `/admin/audit` は例外として許可)。

## 4. 認証設計

### ログイン方法

- メールアドレス+パスワード(Supabase Auth)
- Googleアカウント(Supabase Auth OAuth)
- パスワード再設定(メールリンク)

### 招待制の実現

招待の正は `user_invitations` テーブル([supabase-schema.md §2](./supabase-schema.md#2-ユーザー権限招待)。normalized_email / role / expires_at / accepted_at / invited_by)。

1. Supabaseダッシュボードで **メール・Google両方のサインアップを無効化**(Allow new users to sign up = OFF)。
2. 管理者が管理画面からメールアドレス・氏名・ロールを入力して招待 → サーバーで `user_invitations` 行を作成し、`auth.admin.inviteUserByEmail()`(Secret key、サーバー専用)で招待メールを送信。
3. **未招待ユーザーの作成拒否**: Supabase Authの **Before User Created Hook** で、公式ペイロードの `event.user.email` のみを正規化して有効な `user_invitations` と照合する。メールが欠落・空の場合はフォールバックせず拒否する(フェイルクローズ)。一致しなければユーザー作成自体を拒否し、Google OAuth経由でも未招待アカウントを `auth.users` に残さない。成功時は空JSONを返す。Hook関数は`SECURITY DEFINER set search_path=''`、参照先は`public.user_invitations`へスキーマ修飾し、EXECUTEは`supabase_auth_admin`だけに許可する。
4. 招待受諾(初回ログイン成立)後のプロビジョニング: `app_users` 行作成 → Notion自社担当者ページ作成。複数システムにまたがり原子的でないため、`app_users.provisioning_status` で進行を記録し、**部分失敗は再試行ジョブ(kind=`user_provisioning`)で完遂**する。認証スパイク中はAuth+`app_users`作成済みの`profile_created`を暫定的に利用可能とし、Notion接続後は自社担当者ページ作成と`notion_staff_page_id`保存をもって`completed`へ遷移する。既存`profile_created`は同ジョブでバックフィルする。
5. Googleログインは**招待済みメールアドレスと一致するユーザーのみ**成立する。auth callbackで `app_users` に存在しない・無効なユーザーはセッション破棄+エラー表示(多重防御)。
6. 招待は `status`(pending / accepted / revoked / expired)で状態管理する。有効(pending)な招待はメールアドレスごとに1件のみ(部分ユニークインデックス)。招待リンクの実期限はSupabase Authの **Email OTP Expiration** が決めるため、`user_invitations.expires_at`も実プロジェクトの同設定値から算出して発行時に明示する(独自の既定値を持たない)。有効性判定は「pending かつ 期限内」の両条件で行い、再招待時は期限超過pendingを`expired`へ遷移してから新しいpending行を作成する。取消済みも再招待可能。招待の発行・取消は監査ログ対象。
7. 退職・利用停止は「無効化」(`is_active = false` + Supabase Authのban)。ハード削除しない(監査ログの actor 参照を保持)。
8. Authに存在して`app_users`に存在しないユーザーは管理画面で検知し、人間が招待状態・Authログを確認する。初期版では自動削除しない。自動削除ジョブは人間の承認なしに実装しない。

### Auth Admin APIとBefore User Created Hook(2026-08-06実測)

- **公開経路**(`signUp` / Google OAuth等)では Before User Created Hook が発火し、未招待メールは403で拒否される。
- **`auth.admin.createUser` は Hook を迂回する**(実測)。Admin APIで未招待ユーザーを作成できてしまうため、アプリから直接呼び出してはならない。
- `auth.admin.createUser` / `inviteUserByEmail` / 同等のAdminユーザー作成APIは **`src/lib/auth/admin-api.ts` の server-only ラッパーへ集約**する。新規コードでの `admin.auth.admin.*` 直接呼び出しは禁止し、静的検査テストで検出する。
- ラッパーは通常のユーザー作成前に、**呼び出し元が管理者権限を持つこと**、**pendingかつ期限内の招待が存在すること**、**メールが一致すること**をサーバー側で検証する。検証を通らない場合はAuth APIを呼ばない。
- **初回管理者bootstrap**だけ例外: `app_users` に `is_active` な admin が0件であり、かつ環境変数等で**明示された管理者メール**と一致する場合に限り許可する。それ以外のbootstrapは拒否する。
- 招待・bootstrap・Admin経由のユーザー作成は `audit_logs` へ記録する(`user.invite` / `user.bootstrap` 等)。
- Secret key、仮パスワード、トークン、Authorizationヘッダー、個人情報をログへ出力しない。

### エラー表示(ログイン画面)

- 認証失敗: 「メールアドレスまたはパスワードが正しくありません」
- 未招待・無効ユーザー: 「このアカウントは利用登録されていません。管理者にお問い合わせください」
- レート制限・障害: 「現在ログインできません。しばらくしてからお試しください」

## 5. 監査対象となる権限操作

以下は必ず監査ログ(`audit_logs`)へ記録する。

- ユーザー招待 / 無効化 / 再有効化(`user.invite` / `user.deactivate` / `user.activate`)
- ロール変更(`user.role_change`、before/after付き)
- 権限拒否された管理系操作の試行(`auth.denied`、必要最小限の情報のみ)
