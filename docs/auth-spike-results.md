# 認証技術スパイク結果

実施日: 2026-08-06  
開始コミット: `32fc96d`  
堅牢化コミット: `81410c3`  
状態: **暫定完了**(Google OAuthブラウザE2Eのみ本番公開前に保留)

## 1. 検証結果

| 項目 | 結果 | 内容 |
|---|---|---|
| A 招待済みメール | 成功 | 招待→Auth作成→パスワード設定→`app_users`作成(`profile_created`)→`invitation_status=accepted`→ログイン成功 |
| B 未招待メール拒否 | 成功 | 公開`signUp`が403。`auth.users`に残留なし。Before User Created Hook有効を確認 |
| C Google OAuth | 一部成功 | プロバイダ有効・OAuth URL生成まで確認。**ブラウザでの未招待拒否・招待済みログインは未実施** |
| D 招待状態 | 成功 | expired/revoked/accepted再利用拒否、pending重複拒否(23505)、期限切れ後再招待成功 |
| E 権限 | 成功 | adminのみ招待一覧可。A/B/viewerは不可。viewer書込不可。無効ユーザー`is_active=false`確認 |
| F セキュリティ | 成功 | Secret key非露出、Hook/provisioning RPCの直接EXECUTE拒否、認証エラーに機密なし |

### inviteUserByEmail と Hook

干渉なし。`user_invitations`へpending登録後に`inviteUserByEmail`が成功し、Authユーザーが作成された。

### 採用した招待期限

実プロジェクトのEmail OTP Expirationと同じ **3600秒**。  
`SUPABASE_EMAIL_OTP_EXPIRY_SECONDS=3600` から`user_invitations.expires_at`を算出。

### provisioning_status

- 認証スパイク中はAuth+`app_users`作成完了を`profile_created`とし利用可能
- Notion自社担当者ページ作成後に`completed`へ遷移(未実装。Notion接続時)
- 未プロビジョニングAuthユーザーは自動削除しない(管理画面で検知)

## 2. 本番公開前の確認事項(開発非ブロック)

以下は**本番公開前に必須**。現時点の開発はブロックしない。

1. **未招待Googleアカウント**でログインし、Before User Created Hookで拒否されること
2. **招待済みGoogleアカウント**でログインし、`app_users`作成/更新と招待`accepted`遷移が行われること
3. Google Cloud側のOAuthクライアント制限(許可済みリダイレクトURI)が本番URLでも正しいこと
4. サインアップ無効(`Allow new users to sign up = OFF`)がメール・Google双方で維持されていること

## 2.1 Auth Admin APIとHook(実測追記)

- `auth.admin.createUser` は Before User Created Hook を**迂回**する。未招待ユーザーも作成可能になるため、アプリからの直接呼び出しを禁止する。
- `inviteUserByEmail` / `createUser` は `src/lib/auth/admin-api.ts` に集約し、pending招待・期限・メール一致・権限をサーバー側で検証する。
- 初回管理者bootstrapは active admin 0件かつ明示メールに限定する。
- 操作は `audit_logs` へ記録し、Secret key・仮パスワード・トークンはログへ出さない。

## 3. テスト用ユーザーの後片付け

スパイク検証で作成したAuth/`app_users`は自動削除しない。片付けは管理者が人手で行う。

### 確認SQL

```sql
-- Authに存在するがapp_usersに無い行(未プロビジョニング)
select u.id, u.email, u.created_at
from auth.users u
left join public.app_users a on a.id = u.id
where a.id is null;

-- スパイク用とみられるexample.invalid招待
select id, email, status, created_at
from public.user_invitations
where normalized_email like '%@example.invalid'
order by created_at desc;

-- スパイク用app_users(表示名やメールで判別)
select id, email, role, provisioning_status, is_active, created_at
from public.app_users
order by created_at desc;
```

### 片付け手順(承認後のみ)

1. 管理画面またはSQLで対象ユーザーを特定する
2. **本番利用中の管理者を誤削除しない**
3. 対象の`app_users`を無効化(`is_active=false`)するか、運用承認後に削除する
4. 対応する`user_invitations`のテスト行を削除または`revoked`にする
5. Authユーザー削除が必要な場合のみDashboard/Admin APIで実施する(初期版に自動削除ジョブは実装しない)

`auth-spike-*@example.invalid` 形式のメールは検証用であり、本番ユーザーではない。

## 4. 関連実装

- Hook: `public.hook_before_user_created`
- プロビジョニングRPC: `public.accept_invitation_and_provision`
- クライアント: `@supabase/ssr` + Publishable/Secret key
- 権限: `src/lib/auth/permissions.ts` / `requireUser` / `requirePermission`
