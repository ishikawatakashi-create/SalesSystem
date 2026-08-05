import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-lg font-bold">パスワード再設定</h1>
        <p className="mb-6 text-xs text-slate-500">
          登録済みのメールアドレス宛に再設定用リンクを送信します。
        </p>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
