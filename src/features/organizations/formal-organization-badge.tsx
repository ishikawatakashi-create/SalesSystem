export function FormalOrganizationBadge({
  label = "正式な組織",
}: {
  label?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <path d="M2.5 14V4.5h6V14M8.5 7h4.8v7M1.5 14h13M4.8 7h1.5M4.8 9.5h1.5M4.8 12h1.5M10.8 9.5h1" />
      </svg>
      {label}
    </span>
  );
}
