import Link from "next/link";

export function EmptyState({
  title,
  hint,
  actionHref,
  actionLabel,
}: {
  title: string;
  hint?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-6 text-center">
      <p className="text-xs font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {actionHref && actionLabel && (
        <p className="mt-3">
          <Link
            href={actionHref}
            className="text-xs text-primary hover:underline"
          >
            {actionLabel}
          </Link>
        </p>
      )}
    </div>
  );
}

export function ErrorState({
  message,
  retryHref,
}: {
  message: string;
  retryHref?: string;
}) {
  return (
    <div className="rounded border border-red-200 bg-red-50 px-3 py-6 text-center">
      <p className="text-xs font-medium text-red-800">{message}</p>
      {retryHref && (
        <p className="mt-3">
          <a
            href={retryHref}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            再試行
          </a>
        </p>
      )}
    </div>
  );
}
