import Link from "next/link";

import { resolveProspectLifecycle } from "@/lib/prospects/presentation";

export function ProspectLifecycleStatus({
  promotionStatus,
  promotedPageId,
  organizationName,
}: {
  promotionStatus: string | null | undefined;
  promotedPageId: string | null | undefined;
  organizationName?: string | null;
}) {
  const lifecycle = resolveProspectLifecycle(
    promotionStatus,
    promotedPageId,
  );

  if (lifecycle.kind === "completed") {
    const content = (
      <>
        <CheckIcon />
        <span>{lifecycle.label}</span>
        {organizationName ? <span>→ {organizationName}</span> : null}
      </>
    );
    const className =
      "inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800";
    return promotedPageId ? (
      <Link
        href={`/organizations/${promotedPageId}`}
        className={`${className} hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600`}
      >
        {content}
      </Link>
    ) : (
      <span className={className}>{content}</span>
    );
  }

  if (lifecycle.kind === "completed-link-missing") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
        <WarningIcon />
        {lifecycle.label}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
        <ProspectIcon />
        営業候補
      </span>
      <span
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
          lifecycle.kind === "failed"
            ? "border-red-300 bg-red-50 text-red-800"
            : lifecycle.kind === "processing"
              ? "border-blue-300 bg-blue-50 text-blue-800"
              : "border-dashed border-slate-400 bg-white text-slate-600"
        }`}
      >
        {lifecycle.kind === "failed" ? <WarningIcon /> : <ClockIcon />}
        {lifecycle.label}
      </span>
    </span>
  );
}

function ProspectIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="2" />
      <path d="m9.5 6.5 3-3M10.8 3.5h1.7v1.7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="m5.3 8 1.8 1.8 3.8-4" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.8V8l2.2 1.4" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M8 2.2 14 13H2L8 2.2Z" />
      <path d="M8 5.7v3.5M8 11.2v.2" />
    </svg>
  );
}
