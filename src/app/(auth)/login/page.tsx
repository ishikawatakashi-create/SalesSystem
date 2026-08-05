import { LoginForm } from "./login-form";

const ERROR_MESSAGES: Record<string, string> = {
  not_invited:
    "このアカウントは利用登録されていません。管理者にお問い合わせください。",
  inactive: "このアカウントは無効化されています。管理者にお問い合わせください。",
  not_provisioned:
    "アカウントの準備が完了していません。管理者にお問い合わせください。",
  auth: "認証に失敗しました。もう一度お試しください。",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.auth) : null;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-lg font-bold">営業管理システム</h1>
        <p className="mb-6 text-xs text-slate-500">
          社内向けシステムです。招待されたアカウントでログインしてください。
        </p>
        {errorMessage && (
          <p
            role="alert"
            className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700"
          >
            {errorMessage}
          </p>
        )}
        <LoginForm next={next ?? "/"} />
      </div>
    </main>
  );
}
