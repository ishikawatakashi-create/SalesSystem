"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { navLinkClass } from "@/components/layout/nav-active";

export type NavMenuItem = {
  href: string;
  label: string;
};

/**
 * ヘッダー用ドロップダウン。キーボード・aria 対応。
 */
export function NavDropdown({
  label,
  items,
  active,
  badgeCount,
}: {
  label: string;
  items: NavMenuItem[];
  active: boolean;
  /** 0 または未指定なら非表示 */
  badgeCount?: number;
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
        className={`${navLinkClass(active)} inline-flex items-center gap-0.5`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
        {badgeCount != null && badgeCount > 0 && (
          <span
            className="ml-0.5 rounded bg-slate-200 px-1 text-[10px] font-semibold text-slate-800"
            aria-label={`未確認 ${badgeCount} 件`}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
        <span aria-hidden className="text-[9px] text-slate-400">
          ▼
        </span>
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 min-w-[9rem] rounded border border-slate-200 bg-white py-1 text-xs shadow-sm"
        >
          {items.map((item) => (
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
        </ul>
      )}
    </div>
  );
}
