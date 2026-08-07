"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";

import { searchGlobalAction } from "@/features/search/actions";
import type { GlobalSearchHit } from "@/lib/search/types";

type FlatHit = GlobalSearchHit & { groupLabel: string };

export function GlobalSearchBox() {
  const router = useRouter();
  const inputId = useId();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<FlatHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);

  const runSearch = useCallback((term: string) => {
    const seq = ++reqSeq.current;
    if (term.trim().length < 1) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    startTransition(async () => {
      const res = await searchGlobalAction({ q: term, limitPerEntity: 5 });
      if (seq !== reqSeq.current) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.message);
        setHits([]);
        return;
      }
      const flat: FlatHit[] = [];
      for (const g of res.result.groups) {
        for (const hit of g.hits) {
          flat.push({ ...hit, groupLabel: g.label });
        }
      }
      setHits(flat);
      setActiveIndex(flat.length > 0 ? 0 : -1);
    });
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(q), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, runSearch]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && hits[activeIndex]) {
        go(hits[activeIndex].href);
        return;
      }
      if (q.trim()) {
        setOpen(false);
        router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }
    }
  };

  let lastGroup = "";

  return (
    <div ref={rootRef} className="relative w-56 lg:w-72">
      <label htmlFor={inputId} className="sr-only">
        全体検索
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
        }
        placeholder="検索 (/)"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
      />
      {open && (q.trim().length > 0 || loading || error) && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-auto rounded border border-slate-200 bg-white shadow-sm"
        >
          {loading && (
            <div className="px-3 py-2 text-xs text-slate-500">検索中...</div>
          )}
          {!loading && error && (
            <div className="px-3 py-2 text-xs text-red-600">{error}</div>
          )}
          {!loading && !error && hits.length === 0 && q.trim() && (
            <div className="px-3 py-2 text-xs text-slate-500">
              該当なし
            </div>
          )}
          {!loading &&
            !error &&
            hits.map((hit, index) => {
              const showGroup = hit.groupLabel !== lastGroup;
              lastGroup = hit.groupLabel;
              return (
                <div key={`${hit.entity}-${hit.pageId}`}>
                  {showGroup && (
                    <div className="border-t border-slate-100 bg-slate-50 px-3 py-1 text-[10px] font-medium text-slate-500 first:border-t-0">
                      {hit.groupLabel}
                    </div>
                  )}
                  <button
                    type="button"
                    id={`${listboxId}-opt-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`flex w-full flex-col items-start px-3 py-1.5 text-left text-xs ${
                      index === activeIndex
                        ? "bg-slate-100"
                        : "hover:bg-slate-50"
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => go(hit.href)}
                  >
                    <span className="font-medium text-slate-900">
                      {hit.title}
                      {hit.isArchived && (
                        <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">
                          アーカイブ
                        </span>
                      )}
                    </span>
                    {hit.subtitle && (
                      <span className="truncate text-[11px] text-slate-500">
                        {hit.subtitle}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          {q.trim() && (
            <Link
              href={`/search?q=${encodeURIComponent(q.trim())}`}
              className="block border-t border-slate-100 px-3 py-2 text-xs text-primary hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              すべて見る
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
