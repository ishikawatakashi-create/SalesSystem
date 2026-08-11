"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { navLinkClass } from "@/components/layout/nav-active";

export type NavMenuItem = {
  href: string;
  label: string;
};

export type NavMenuSection = {
  id: string;
  label: string;
  description: string;
  icon: "organization" | "prospect";
  items: NavMenuItem[];
  columns?: 1 | 2;
};

type NavDropdownProps = {
  label: string;
  active: boolean;
  /** 0 または未指定なら非表示 */
  badgeCount?: number;
} & (
  | { items: NavMenuItem[]; sections?: never }
  | { items?: never; sections: NavMenuSection[] }
);

/**
 * ヘッダー用ドロップダウン。キーボード・aria 対応。
 */
export function NavDropdown({
  label,
  items,
  sections,
  active,
  badgeCount,
}: NavDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOnOpenRef = useRef<"first" | "last" | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    const target = focusOnOpenRef.current;
    if (!open || !target) return;
    focusOnOpenRef.current = null;
    const links = panelRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]");
    if (!links?.length) return;
    links[target === "first" ? 0 : links.length - 1]?.focus();
  }, [open]);

  const renderItem = (item: NavMenuItem) => (
    <li key={item.href}>
      <Link
        href={item.href}
        className="block rounded px-2 py-1.5 text-slate-700 hover:bg-white hover:text-slate-950 focus:bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-500"
        onClick={() => setOpen(false)}
      >
        {item.label}
      </Link>
    </li>
  );

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`${navLinkClass(active)} inline-flex items-center gap-0.5 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const target = e.key === "ArrowDown" ? "first" : "last";
            if (open) {
              const links = panelRef.current?.querySelectorAll<HTMLAnchorElement>(
                "a[href]",
              );
              links?.[target === "first" ? 0 : links.length - 1]?.focus();
            } else {
              focusOnOpenRef.current = target;
              setOpen(true);
            }
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
        <div
          ref={panelRef}
          id={menuId}
          className={`absolute left-0 top-full z-40 mt-1 max-h-[calc(100vh-4rem)] overflow-y-auto rounded border border-slate-200 bg-white text-xs shadow-md max-sm:fixed max-sm:left-4 max-sm:right-4 max-sm:top-12 max-sm:w-auto ${
            sections
              ? "w-[22rem] max-w-[calc(100vw-2rem)] space-y-1 p-1"
              : "min-w-[9rem] py-1"
          }`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
              return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              return;
            }
            const links = Array.from(
              panelRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [],
            );
            if (links.length === 0) return;
            e.preventDefault();
            const current = links.indexOf(document.activeElement as HTMLAnchorElement);
            const nextIndex =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? links.length - 1
                  : e.key === "ArrowUp"
                    ? current <= 0
                      ? links.length - 1
                      : current - 1
                    : current < 0 || current === links.length - 1
                      ? 0
                      : current + 1;
            links[nextIndex]?.focus();
          }}
        >
          {sections ? (
            sections.map((section) => (
              <section
                key={section.id}
                aria-labelledby={`${menuId}-${section.id}`}
                className="overflow-hidden rounded border border-slate-200 bg-slate-50/70"
              >
                <div className="flex items-start gap-2 border-b border-slate-200 px-2.5 py-2">
                  <NavSectionIcon type={section.icon} />
                  <div className="min-w-0">
                    <h2
                      id={`${menuId}-${section.id}`}
                      className="font-semibold text-slate-900"
                    >
                      {section.label}
                    </h2>
                    <p className="mt-0.5 text-[10px] leading-4 text-slate-500">
                      {section.description}
                    </p>
                  </div>
                </div>
                <ul
                  className={`gap-x-1 p-1 ${
                    section.columns === 2 ? "grid grid-cols-2" : "grid"
                  }`}
                >
                  {section.items.map(renderItem)}
                </ul>
              </section>
            ))
          ) : (
            <ul>{items?.map(renderItem)}</ul>
          )}
        </div>
      )}
    </div>
  );
}

function NavSectionIcon({
  type,
}: {
  type: NavMenuSection["icon"];
}) {
  if (type === "organization") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="mt-0.5 h-4 w-4 shrink-0 text-slate-600"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M3.5 17V5.5h8V17M11.5 8.5h5V17M2 17h16M6.5 8h2M6.5 11h2M6.5 14h2M14 11h1" />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="mt-0.5 h-4 w-4 shrink-0 text-slate-600"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="3" />
      <path d="m12.2 7.8 4.3-4.3M13.8 3.5h2.7v2.7" />
    </svg>
  );
}
