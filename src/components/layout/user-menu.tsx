"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

export function UserMenu({
  displayName,
  roleLabel,
  adminItems,
}: {
  displayName: string;
  roleLabel: string;
  adminItems: Array<{ href: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="inline-flex max-w-[10rem] items-center gap-1 truncate rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate" title={`${displayName}（${roleLabel}）`}>
          {displayName}
        </span>
        <span aria-hidden className="text-[9px] text-slate-400">
          ▼
        </span>
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 min-w-[11rem] rounded border border-slate-200 bg-white py-1 text-xs shadow-sm"
        >
          <li role="none" className="px-3 py-1.5 text-slate-500">
            {roleLabel}
          </li>
          {adminItems.length > 0 && (
            <>
              <li role="separator" className="my-1 border-t border-slate-100" />
              {adminItems.map((item) => (
                <li key={item.href} role="none">
                  <Link
                    role="menuitem"
                    href={item.href}
                    className="block px-3 py-1.5 text-slate-700 hover:bg-slate-50"
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </>
          )}
          <li role="separator" className="my-1 border-t border-slate-100" />
          <li role="none">
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                role="menuitem"
                className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50"
              >
                ログアウト
              </button>
            </form>
          </li>
        </ul>
      )}
    </div>
  );
}
