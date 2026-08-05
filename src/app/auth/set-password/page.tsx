import { SetPasswordForm } from "./set-password-form";

export default function SetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-lg font-bold">パスワード設定</h1>
        <p className="mb-6 text-xs text-slate-500">
          ログインに使用するパスワードを設定してください。
        </p>
        <SetPasswordForm />
      </div>
    </main>
  );
}
