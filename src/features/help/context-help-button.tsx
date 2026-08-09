"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { findScreenGuide } from "@/lib/help/screens";

export function ContextHelpButton({ pathname }: { pathname: string }) {
  const guide = findScreenGuide(pathname);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!guide) return null;

  return (
    <>
      <button
        type="button"
        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        ? この画面の使い方
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded border border-slate-200 bg-white p-4 text-xs shadow-lg"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <h2 id={titleId} className="text-sm font-semibold text-slate-900">
                {guide.title}
              </h2>
              <button
                ref={closeRef}
                type="button"
                className="rounded border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-50"
                onClick={() => setOpen(false)}
              >
                閉じる
              </button>
            </div>
            <p className="text-slate-600">{guide.summary}</p>
            <ol className="mt-3 list-decimal space-y-1 pl-4 text-slate-800">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {guide.tips && guide.tips.length > 0 && (
              <ul className="mt-3 space-y-1 rounded border border-amber-100 bg-amber-50 p-2 text-slate-700">
                {guide.tips.map((tip) => (
                  <li key={tip}>※ {tip}</li>
                ))}
              </ul>
            )}
            {guide.articleSlug && (
              <p className="mt-3">
                <Link
                  href={`/help/${guide.articleSlug}`}
                  className="text-slate-900 underline"
                  onClick={() => setOpen(false)}
                >
                  詳しいヘルプを見る
                </Link>
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
