"use client";

export default function ComplaintsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-sm font-medium text-slate-900">
        クレーム情報の取得に失敗しました
      </p>
      <p className="mt-1 text-xs text-slate-500">
        通信状態を確認のうえ、再試行してください。
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-4 rounded border border-slate-300 bg-white px-4 py-1.5 text-xs hover:bg-slate-50"
      >
        再試行
      </button>
    </div>
  );
}
