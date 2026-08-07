import Link from "next/link";

/** 0件時のコンパクト1行表示 */
export function CompactEmptyState({
  message,
  actionHref,
  actionLabel,
}: {
  message: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <p className="py-1 text-xs text-slate-500">
      {message}
      {actionHref && actionLabel ? (
        <>
          {" "}
          <Link
            href={actionHref}
            className="font-medium text-slate-800 underline-offset-2 hover:underline"
          >
            {actionLabel}
          </Link>
        </>
      ) : null}
    </p>
  );
}
