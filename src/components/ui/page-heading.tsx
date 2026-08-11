import type { ReactNode } from "react";

export function PageHeading({
  title,
  description,
  status,
  meta,
  supporting,
  actions,
}: {
  title: string;
  description: string;
  status?: ReactNode;
  meta?: ReactNode;
  supporting?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-bold text-slate-900">{title}</h1>
          {status}
          {meta ? <span className="text-xs text-slate-500">{meta}</span> : null}
        </div>
        <p className="mt-0.5 text-xs text-slate-600">{description}</p>
        {supporting ? (
          <div className="mt-1 text-[11px] text-slate-500">{supporting}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
