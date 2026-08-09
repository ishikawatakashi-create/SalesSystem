"use client";

import { usePathname } from "next/navigation";

import { ContextHelpButton } from "@/features/help/context-help-button";
import { findScreenGuide } from "@/lib/help/screens";

/** 迷いやすい画面だけ、ページ上部に小さなヘルプ導線を出す */
export function ContextHelpSlot() {
  const pathname = usePathname() || "/";
  if (!findScreenGuide(pathname)) return null;
  return (
    <div className="mb-2 flex justify-end">
      <ContextHelpButton pathname={pathname} />
    </div>
  );
}
