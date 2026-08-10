import { InviteCompletion } from "./invite-completion";

export default function InvitePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-lg font-bold">招待を確認しています</h1>
        <InviteCompletion />
      </div>
    </main>
  );
}
